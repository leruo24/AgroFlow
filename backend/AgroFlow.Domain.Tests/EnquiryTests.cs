using System;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 6c (part 2): the public "Get a call back" form.
public class EnquiryTests
{
    private static EnquiryForm Good() => new()
    {
        FullName = "Thandi Nkosi", Phone = "082 123 4567", Email = "", Province = "Western Cape", Town = "Ceres",
        FarmSizeHa = 2, Crops = new[] { "potato", "maize" }, BestTime = "morning", Notes = "", Consent = true,
    };

    [Theory]
    [InlineData("082 123 4567", "+27821234567")]
    [InlineData("0821234567", "+27821234567")]
    [InlineData("+27 82 123 4567", "+27821234567")]
    [InlineData("27821234567", "+27821234567")]
    [InlineData("(021) 555-0101", "+27215550101")]
    [InlineData("082 123 456", null)]       // one digit short
    [InlineData("+44 20 7946 0958", null)]  // not South African
    [InlineData("0921234567", null)]        // no SA number starts 09
    [InlineData("082-ABC-4567", null)]
    [InlineData("", null)]
    public void Phone_numbers_are_South_African(string input, string? expected)
    {
        Assert.Equal(expected, EnquiryRules.NormalisePhone(input));
    }

    [Fact]
    public void A_complete_form_passes_and_every_rule_is_enforced()
    {
        Assert.Null(EnquiryRules.Check(Good()));

        void Fails(Action<EnquiryForm> change)
        {
            var f = Good();
            change(f);
            Assert.NotNull(EnquiryRules.Check(f));
        }

        Fails(f => f.FullName = " ");
        Fails(f => f.Phone = "123");
        Fails(f => f.Email = "not-an-email");
        Fails(f => f.Province = "Atlantis");
        Fails(f => f.Town = "");
        Fails(f => f.FarmSizeHa = 0);
        Fails(f => f.Crops = Array.Empty<string>());
        Fails(f => f.Crops = new[] { "dragonfruit" });
        Fails(f => f.Crops = new[] { "other" });            // Other needs words
        Fails(f => f.BestTime = "midnight");
        Fails(f => f.Notes = new string('x', 1001));
        Fails(f => f.Consent = false);                      // POPIA consent is required

        var other = Good();
        other.Crops = new[] { "other" };
        other.CropsOther = "Spinach";
        Assert.Null(EnquiryRules.Check(other));

        var optional = Good();
        optional.Email = null;
        optional.FarmSizeHa = null;
        optional.Notes = null;
        Assert.Null(EnquiryRules.Check(optional));
    }

    [Fact]
    public void The_admin_message_names_who_where_what_and_when()
    {
        Assert.Equal("New enquiry: Thandi Nkosi, Ceres, potato, leafy vegetables, Spinach, call in the morning",
            EnquiryRules.AdminMessage(" Thandi Nkosi ", "Ceres", new[] { "potato", "leafy_veg", "other" }, "Spinach", "morning"));
    }

    [Fact]
    public void The_limit_is_per_address_and_per_hour()
    {
        var limiter = new EnquiryRateLimiter();
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < EnquiryRateLimiter.MaxPerWindow; i++) Assert.True(limiter.TryTake("1.2.3.4", now));
        Assert.False(limiter.TryTake("1.2.3.4", now));
        Assert.True(limiter.TryTake("5.6.7.8", now));
        Assert.True(limiter.TryTake("1.2.3.4", now + EnquiryRateLimiter.Window + TimeSpan.FromSeconds(1)));
    }

    // The route itself, with no database: every path tested here returns
    // before one is needed, so null stands in for it - touching it would throw.
    private static async Task<IResult> Submit(EnquiryForm form, EnquiryRateLimiter limiter, string ip = "9.9.9.9")
    {
        var method = typeof(EnquiryEndpoints).GetMethod("SubmitAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Forwarded-For"] = ip;
        return await (Task<IResult>)method.Invoke(null, new object?[]
        {
            form, context, null, limiter, new NullNotificationService(NullLogger<NullNotificationService>.Instance),
            NullLoggerFactory.Instance, CancellationToken.None,
        })!;
    }

    [Fact]
    public async Task A_filled_honeypot_gets_the_thank_you_and_nothing_is_stored()
    {
        var bot = Good();
        bot.Website = "http://spam.example";
        var result = await Submit(bot, new EnquiryRateLimiter());
        Assert.Equal(StatusCodes.Status200OK, ((IStatusCodeHttpResult)result).StatusCode);
    }

    [Fact]
    public async Task A_bad_form_is_refused_with_the_reason()
    {
        var bad = Good();
        bad.Consent = false;
        var result = await Submit(bad, new EnquiryRateLimiter());
        Assert.Equal(StatusCodes.Status400BadRequest, ((IStatusCodeHttpResult)result).StatusCode);
    }

    [Fact]
    public async Task The_sixth_enquiry_in_an_hour_from_one_address_is_refused()
    {
        var limiter = new EnquiryRateLimiter();
        var bad = Good();
        bad.Consent = false; // refused before the database, but still counted
        for (var i = 0; i < EnquiryRateLimiter.MaxPerWindow; i++) await Submit(bad, limiter);
        var result = await Submit(bad, limiter);
        Assert.Equal(StatusCodes.Status429TooManyRequests, ((IStatusCodeHttpResult)result).StatusCode);
    }

    [Fact]
    public void Logged_calls_need_what_their_outcome_needs()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Null(EnquiryRules.CheckCall("wants", null, null, null, now));
        Assert.Null(EnquiryRules.CheckCall("no_answer", null, null, null, now));
        Assert.NotNull(EnquiryRules.CheckCall("maybe", null, null, null, now));
        Assert.NotNull(EnquiryRules.CheckCall("not_interested", null, null, null, now));       // reason required
        Assert.NotNull(EnquiryRules.CheckCall("not_interested", "other", " ", null, now));     // Other needs text
        Assert.Null(EnquiryRules.CheckCall("not_interested", "other", "Moving away", null, now));
        Assert.Null(EnquiryRules.CheckCall("not_interested", "no_internet", null, null, now));
        Assert.NotNull(EnquiryRules.CheckCall("callback", null, null, null, now));
        Assert.NotNull(EnquiryRules.CheckCall("callback", null, null, now.AddMinutes(-1), now));
        Assert.Null(EnquiryRules.CheckCall("callback", null, null, now.AddDays(1), now));

        Assert.False(EnquiryRules.SuggestClosing(2));
        Assert.True(EnquiryRules.SuggestClosing(3));
    }

    [Fact]
    public void What_each_call_does_to_the_enquiry()
    {
        var when = DateTimeOffset.UtcNow.AddDays(1);

        var wants = EnquiryAdminEndpoints.EffectOf("wants", 0, null);
        Assert.Equal("open", wants.Status);
        Assert.Contains("start onboarding", wants.Message);

        var later = EnquiryAdminEndpoints.EffectOf("callback", 1, when);
        Assert.Equal(when, later.CallbackAt);
        Assert.Equal(1, later.NoAnswerCount);

        var first = EnquiryAdminEndpoints.EffectOf("no_answer", 0, null);
        Assert.Equal(1, first.NoAnswerCount);
        Assert.False(first.SuggestClosing);
        var third = EnquiryAdminEndpoints.EffectOf("no_answer", 2, null);
        Assert.Equal(3, third.NoAnswerCount);
        Assert.True(third.SuggestClosing);

        var no = EnquiryAdminEndpoints.EffectOf("not_interested", 0, null);
        Assert.Equal("lost", no.Status);
    }

    [Theory]
    [InlineData("lost", false, true)]
    [InlineData("closed", false, true)]
    [InlineData("open", false, false)]   // still being worked: details are still needed
    [InlineData("won", false, false)]    // now a farmer with an account
    [InlineData("new", false, false)]
    [InlineData("lost", true, false)]    // already done
    public void Personal_details_are_deleted_only_once_an_enquiry_has_ended(string status, bool alreadyAnonymised, bool allowed)
    {
        Assert.Equal(allowed, EnquiryAdminEndpoints.CanAnonymise(status, alreadyAnonymised ? DateTimeOffset.UtcNow : null));
    }

    [Fact]
    public void No_admin_enquiry_body_carries_an_actor()
    {
        foreach (var t in new[] { typeof(EnquiryTakeOverBody), typeof(EnquiryCallBody), typeof(EnquiryCloseBody) })
        {
            Assert.DoesNotContain(t.GetProperties(), p =>
                p.Name.Contains("Caller", StringComparison.Ordinal) || p.Name.Contains("Actor", StringComparison.Ordinal)
                || p.Name.Contains("Handler", StringComparison.Ordinal) || p.Name.EndsWith("By", StringComparison.Ordinal));
        }
    }
}

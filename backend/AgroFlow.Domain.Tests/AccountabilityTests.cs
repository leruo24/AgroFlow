using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using AgroFlow.Api.Endpoints;
using AgroFlow.Business;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;

namespace AgroFlow.Domain.Tests;

// Item 5: whoever acts is on the record. No database - the rules are pure,
// and the /assign refusal happens before any database work.
public class AccountabilityTests
{
    private static readonly Guid Me = Guid.Parse("00000000-0000-4000-8000-0000000000aa");
    private static readonly Guid Them = Guid.Parse("00000000-0000-4000-8000-0000000000bb");

    [Fact]
    public void Claim_PutsOnlyTheCallersName_AndNeverOverSomeoneElse()
    {
        Assert.Equal(HandlingOutcome.Claimed, HandlingRules.Claim(null, Me));
        Assert.Equal(HandlingOutcome.AlreadyYours, HandlingRules.Claim(Me, Me));
        Assert.Equal(HandlingOutcome.HeldByOther, HandlingRules.Claim(Them, Me));
    }

    [Theory]
    [InlineData(null, HandlingOutcome.ReasonRequired)]
    [InlineData("", HandlingOutcome.ReasonRequired)]
    [InlineData("  ", HandlingOutcome.ReasonRequired)]
    [InlineData("ok", HandlingOutcome.ReasonRequired)]
    [InlineData("sick", HandlingOutcome.TakenOver)]
    [InlineData("Farmer called me directly", HandlingOutcome.TakenOver)]
    public void TakeOver_NeedsAReason(string? reason, HandlingOutcome expected)
    {
        Assert.Equal(expected, HandlingRules.TakeOver(Them, Me, reason));
    }

    [Fact]
    public void TakeOver_IsOnlyForSomethingSomeoneElseHolds()
    {
        Assert.Equal(HandlingOutcome.NothingToTakeOver, HandlingRules.TakeOver(null, Me, "a good reason"));
        Assert.Equal(HandlingOutcome.AlreadyYours, HandlingRules.TakeOver(Me, Me, "a good reason"));
    }

    [Fact]
    public void OnlyTheHandler_CanLetGo()
    {
        Assert.Equal(HandlingOutcome.Released, HandlingRules.Release(Me, Me));
        Assert.Equal(HandlingOutcome.NotYours, HandlingRules.Release(Them, Me));
        Assert.Equal(HandlingOutcome.NothingToRelease, HandlingRules.Release(null, Me));
    }

    [Theory]
    [InlineData("alerts", "resolve", true)]
    [InlineData("alerts", "escalate", true)]
    [InlineData("maintenance", "complete", true)]
    [InlineData("maintenance", "resolve", false)]
    [InlineData("requests", "note", true)]
    [InlineData("requests", "assign", false)]   // there is no assign action, for anything
    [InlineData("alerts", "assign", false)]
    [InlineData("users", "note", false)]
    public void Actions_AreAFixedListPerKind_AndNoneAssigns(string kind, string action, bool allowed)
    {
        Assert.Equal(allowed, HandlingRules.ActionAllowed(kind, action));
    }

    [Fact]
    public void TheOldAssignRule_AcceptsOnlyTheCallerOrNobody()
    {
        Assert.True(HandlingRules.AssignAllowed(null, Me));
        Assert.True(HandlingRules.AssignAllowed(Me, Me));
        Assert.False(HandlingRules.AssignAllowed(Them, Me));
    }

    [Fact]
    public async Task TheAssignRoute_RefusesAnotherPersonsId_With403()
    {
        var method = typeof(AdminRequestEndpoints).GetMethod("AssignAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
        var user = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", Me.ToString()) }, "test"));

        // Refused before any database work, so null stands in for the data
        // source and audit log - a refusal that touched them would throw.
        var task = (Task<IResult>)method.Invoke(null, new object?[]
        {
            42L, new AssignRequestBody(Them), user, null, null, CancellationToken.None,
        })!;
        var result = await task;

        Assert.Equal(StatusCodes.Status403Forbidden, ((IStatusCodeHttpResult)result).StatusCode);
    }

    [Fact]
    public void NoRequestBody_CarriesAnActor_AndOneSentIsIgnored()
    {
        // The bodies of every handling route: what was done, never who did it.
        foreach (var type in new[] { typeof(TakeOverBody), typeof(HandlingActionBody) })
        {
            var names = type.GetProperties().Select(p => p.Name.ToLowerInvariant());
            Assert.DoesNotContain(names, n => n.Contains("actor") || n.Contains("profile") || n.Contains("user") || n.Contains("handler") || n.Contains("by"));
        }

        var body = JsonSerializer.Deserialize<HandlingActionBody>(
            """{"action":"resolve","note":"done","actorProfileId":"00000000-0000-4000-8000-0000000000bb","resolvedBy":"Them"}""",
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal("resolve", body.Action);
        Assert.Equal("done", body.Note);
    }

    [Theory]
    [InlineData("resolve", "resolved")]
    [InlineData("close", "closed")]
    [InlineData("reopen", "reopened")]
    [InlineData("complete", "completed")]
    [InlineData("note", "note_added")]
    public void EveryActionHasATimelineVerb(string action, string past)
    {
        Assert.Equal(past, HandlingEndpoints.Past(action));
    }
}

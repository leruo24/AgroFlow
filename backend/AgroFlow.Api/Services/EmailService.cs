using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace AgroFlow.Api.Services;

public sealed record FarmerWelcomeEmail(
    string FarmerName,
    string Email,
    string TemporaryPassword,
    string FarmName,
    string FarmLocation
);

public interface IEmailService
{
    Task SendFarmerWelcomeEmailAsync(
        FarmerWelcomeEmail email,
        CancellationToken cancellationToken
    );
}

public sealed class ResendEmailService : IEmailService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ResendEmailService> _logger;

    public ResendEmailService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<ResendEmailService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task SendFarmerWelcomeEmailAsync(
        FarmerWelcomeEmail email,
        CancellationToken cancellationToken)
    {
        var apiKey =
            _configuration["Resend:ApiKey"]
            ?? throw new InvalidOperationException(
                "Missing Resend:ApiKey configuration."
            );

        var fromEmail =
            _configuration["Resend:FromEmail"]
            ?? throw new InvalidOperationException(
                "Missing Resend:FromEmail configuration."
            );

        var fromName =
            _configuration["Resend:FromName"]
            ?? "AgroFlow";

        var client =
            _httpClientFactory.CreateClient();

        client.DefaultRequestHeaders.Add(
            "Authorization",
            $"Bearer {apiKey}"
        );

        var payload = new
        {
            from = $"{fromName} <{fromEmail}>",
            to = new[] { email.Email },
            subject = "Welcome to AgroFlow",
            text =
                $"""
                Welcome to AgroFlow, {email.FarmerName}!

                Your AgroFlow farmer account has been created.

                Login email:
                {email.Email}

                Temporary password:
                {email.TemporaryPassword}

                Farm:
                {email.FarmName}

                Location:
                {email.FarmLocation}

                You can use these details to log into the AgroFlow farmer application.

                Please keep your login details secure.

                Regards,
                AgroFlow
                """
        };

        using var response = await client.PostAsJsonAsync(
            "https://api.resend.com/emails",
            payload,
            cancellationToken
        );

        if (!response.IsSuccessStatusCode)
        {
            var error =
                await response.Content.ReadAsStringAsync(
                    cancellationToken
                );

            _logger.LogError(
                "Resend email failed for {Email}. Status: {StatusCode}. Response: {Response}",
                email.Email,
                response.StatusCode,
                error
            );

            throw new InvalidOperationException(
                "The farmer account was created, but the welcome email could not be sent."
            );
        }

        _logger.LogInformation(
            "Welcome email sent successfully to {Email}.",
            email.Email
        );
    }
}
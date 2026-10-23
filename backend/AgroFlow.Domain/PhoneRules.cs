#nullable enable

namespace AgroFlow.Business;

// One phone rule for every form (AF-20): the public call-back form, staff onboarding and the
// app's enquiry. The same cases are checked on the client and here, from one fixture file
// (apps/web/admin/tests/fixtures/phone-cases.json), so the two cannot drift apart. A number
// that passes is well formed; it is never proof that the person owns it.
public static class PhoneRules
{
    public const string Example = "082 123 4567";

    public const string Message = "Please give a South African phone number, for example " + Example + ".";

    // Null when fine; otherwise the sentence to show next to the field.
    public static string? Check(string? phone) =>
        EnquiryRules.NormalisePhone(phone) is null ? Message : null;
}

#nullable enable
using System;
using System.Globalization;

namespace AgroFlow.Business;

// One way to write an area (AF-07): never "0 ha" for a real small farm. Hectares to the
// precision the value needs, with square metres beside it when the farm is under a hectare:
// "0.02 ha (200 m²)", "1.5 ha", "0.0001 ha (1 m²)". The admin site and the app have the same
// rule (formatArea in apps/web/admin/src/lib/format.ts and apps/mobile/src/lib/area.ts), checked
// against the same cases.
public static class AreaFormat
{
    public const double SquareMetresPerHectare = 10_000;

    public static double ToHectares(double squareMetres) => squareMetres / SquareMetresPerHectare;

    public static double ToSquareMetres(double hectares) => hectares * SquareMetresPerHectare;

    // Hectares with as many decimals as it takes to not round a real area to zero (up to 4,
    // which is 1 m²), trailing zeros dropped.
    public static string Hectares(double hectares)
    {
        if (double.IsNaN(hectares) || hectares <= 0) return "0 ha";
        var decimals = hectares >= 0.01 ? 2 : hectares >= 0.001 ? 3 : 4;
        var rounded = Math.Round(hectares, decimals, MidpointRounding.AwayFromZero);
        if (rounded <= 0) rounded = Math.Pow(10, -decimals);
        return rounded.ToString("0.####", CultureInfo.InvariantCulture) + " ha";
    }

    public static string SquareMetres(double squareMetres) =>
        Math.Round(squareMetres, squareMetres < 10 ? 1 : 0, MidpointRounding.AwayFromZero)
            .ToString("#,0.#", CultureInfo.InvariantCulture).Replace(",", " ") + " m²";

    // "0.02 ha (200 m²)" under a hectare, "1.5 ha" from a hectare up. Null for no area.
    public static string? Describe(double? hectares)
    {
        if (hectares is not { } ha || double.IsNaN(ha) || ha <= 0) return null;
        return ha < 1 ? $"{Hectares(ha)} ({SquareMetres(ToSquareMetres(ha))})" : Hectares(ha);
    }
}

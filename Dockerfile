# Railway build image for backend/AgroFlow.Api.
#
# Railway's Nixpacks auto-builder has no .NET provider, so the service is built
# from this Dockerfile instead. Build context is the REPO ROOT (not backend/),
# because AgroFlow.Api has a ProjectReference to the sibling AgroFlow.Domain
# project - both must be inside the context for the restore to resolve.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy only the project files first so `dotnet restore` lands on its own Docker
# layer: editing C# source then reuses the cached NuGet restore instead of
# re-downloading every package.
COPY backend/AgroFlow.Api/AgroFlow.Api.csproj backend/AgroFlow.Api/
COPY backend/AgroFlow.Domain/AgroFlow.Domain.csproj backend/AgroFlow.Domain/
RUN dotnet restore backend/AgroFlow.Api/AgroFlow.Api.csproj

# Then the sources. .dockerignore keeps local bin/obj out, which would
# otherwise poison the container build with Windows-built artifacts.
COPY backend/ backend/
RUN dotnet publish backend/AgroFlow.Api/AgroFlow.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore


FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# QuestPDF renders through SkiaSharp, which P/Invokes libfontconfig at runtime.
# The aspnet:8.0 image is Debian slim and does not ship it, so any future PDF
# endpoint would fail with a DllNotFoundException without this.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .

ENV ASPNETCORE_ENVIRONMENT=Production
# Fallback only. Railway injects its own PORT at runtime and it wins (see CMD).
ENV PORT=8080
EXPOSE 8080

# ASPNETCORE_URLS must be built at RUNTIME, not as an ENV line: Docker expands
# ENV values at BUILD time, so `ENV ASPNETCORE_URLS=http://+:$PORT` would bake
# in the build-time value and ignore the port Railway actually assigns. The
# shell form below defers expansion until the container starts.
CMD ASPNETCORE_URLS=http://+:${PORT} dotnet AgroFlow.Api.dll

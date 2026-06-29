import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

export function createAuthContext() {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  return { authStorage, modelRegistry };
}

export function listLoginProviderOptions(modelRegistry) {
  const authStorage = modelRegistry.authStorage;
  const byId = new Map();
  for (const provider of authStorage.getOAuthProviders()) {
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name,
      authType: "oauth",
      removable: authStorage.has(provider.id),
      status: modelRegistry.getProviderAuthStatus(provider.id),
    });
  }
  for (const model of modelRegistry.getAll()) {
    if (byId.has(model.provider)) continue;
    byId.set(model.provider, {
      id: model.provider,
      name: modelRegistry.getProviderDisplayName(model.provider),
      authType: "api_key",
      removable: authStorage.has(model.provider),
      status: modelRegistry.getProviderAuthStatus(model.provider),
    });
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function listLogoutProviderOptions(modelRegistry) {
  const authStorage = modelRegistry.authStorage;
  const options = [];
  for (const providerId of authStorage.list()) {
    const credential = authStorage.get(providerId);
    if (!credential) continue;
    options.push({
      id: providerId,
      name: modelRegistry.getProviderDisplayName(providerId),
      authType: credential.type,
      status: modelRegistry.getProviderAuthStatus(providerId),
    });
  }
  return options.sort((left, right) => left.name.localeCompare(right.name));
}

export function authProvidersPayload(modelRegistry) {
  const loginProviders = listLoginProviderOptions(modelRegistry);
  const logoutProviders = listLogoutProviderOptions(modelRegistry);
  return {
    loginProviders,
    logoutProviders,
    storedProviderCount: logoutProviders.length,
    browserLoginSupported: false,
    guidance: [
      "OAuth and API-key login flows still require the Pi TUI /login command.",
      "Web UI logout only removes credentials stored in auth.json by /login.",
      "Environment variables and models.json credentials are not removable from the Web UI.",
    ].join("\n"),
  };
}

export function logoutStoredProvider(modelRegistry, providerId) {
  const id = String(providerId || "").trim();
  if (!id) throw new Error("provider is required");
  const authStorage = modelRegistry.authStorage;
  if (!authStorage.has(id)) {
    throw new Error(`No stored credentials found for provider: ${id}`);
  }
  const credential = authStorage.get(id);
  authStorage.logout(id);
  modelRegistry.refresh();
  const name = modelRegistry.getProviderDisplayName(id);
  const message = credential?.type === "oauth"
    ? `Logged out of ${name}.`
    : `Removed stored API key for ${name}. Environment variables and models.json config are unchanged.`;
  return { provider: id, providerName: name, authType: credential?.type, message };
}

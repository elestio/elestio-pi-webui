import { evaluateTrustGuards, guardsForNativeCommand, isLocalRequest, trustBlockMessage } from "./trust-boundaries.mjs";

export const NATIVE_COMMAND_STATUSES = new Set([
  "succeeded",
  "degraded",
  "unavailable",
  "confirmation_required",
  "blocked",
]);

export const NATIVE_RESPONSE_LEVELS = new Set(["info", "warn", "error"]);
export const NATIVE_REFRESH_TARGETS = new Set(["state", "tabs", "commands", "themes", "workspace"]);

export function nativeParitySurfaces(matrix) {
  return Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
}

export function nativeSlashCommandEntries(matrix) {
  return nativeParitySurfaces(matrix)
    .filter((surface) => surface?.kind === "slash-command")
    .map((surface) => {
      const name = String(surface.command?.name || surface.id || "").replace(/^\//, "").trim();
      return {
        name,
        description: String(surface.command?.description || surface.title || `/${name}`),
        source: "native",
        location: "Pi",
        nativeParity: {
          status: surface.webStatus || "unsupported",
          priority: surface.priority || "P2",
          guards: Array.isArray(surface.guards) ? surface.guards : [],
          sensitive: surface.sensitive === true,
        },
      };
    })
    .filter((command) => command.name);
}

export function nativeParitySurfaceForCommand(name, matrix) {
  return nativeParitySurfaces(matrix).find((surface) => surface.kind === "slash-command" && surface.command?.name === name) || null;
}

export function parseSlashCommand(message, nativeSlashCommandNames) {
  const allowed = nativeSlashCommandNames instanceof Set ? nativeSlashCommandNames : new Set(nativeSlashCommandNames || []);
  const text = String(message || "").trim();
  if (!text.startsWith("/") || text.includes("\n")) return undefined;
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  if (!allowed.has(name)) return undefined;
  return { name, args: (match[2] || "").trim(), text };
}

export function rpcSuccess(command, data = {}) {
  return { type: "response", command, success: true, data };
}

function defaultStatusForSurface(surface) {
  if (!surface) return "unavailable";
  if (surface.webStatus === "implemented") return "succeeded";
  if (surface.webStatus === "degraded") return "degraded";
  return "unavailable";
}

function defaultLevelForStatus(status) {
  if (status === "succeeded") return "info";
  if (status === "confirmation_required") return "warn";
  if (status === "blocked") return "error";
  return "warn";
}

function normalizeCards(data = {}) {
  const cards = [];
  if (Array.isArray(data.cards)) {
    for (const card of data.cards) {
      if (!card || typeof card !== "object") continue;
      const content = String(card.content || card.message || "").trim();
      if (!content) continue;
      cards.push({
        kind: String(card.kind || "transcript"),
        title: card.title ? String(card.title) : undefined,
        content,
        level: NATIVE_RESPONSE_LEVELS.has(card.level) ? card.level : "info",
      });
    }
  }
  if (!cards.length && data.message) {
    cards.push({
      kind: "transcript",
      title: data.command ? `/${data.command}` : undefined,
      content: String(data.message),
      level: NATIVE_RESPONSE_LEVELS.has(data.level) ? data.level : defaultLevelForStatus(data.status),
    });
  }
  return cards;
}

function normalizeToasts(data = {}) {
  const toasts = [];
  if (Array.isArray(data.toasts)) {
    for (const toast of data.toasts) {
      if (!toast || typeof toast !== "object") continue;
      const message = String(toast.message || "").trim();
      if (!message) continue;
      toasts.push({
        level: NATIVE_RESPONSE_LEVELS.has(toast.level) ? toast.level : "info",
        message,
      });
    }
  }
  return toasts;
}

function normalizeWarnings(data = {}) {
  const warnings = [];
  if (Array.isArray(data.warnings)) {
    for (const warning of data.warnings) if (warning) warnings.push(String(warning));
  }
  if (data.safetyRestriction) warnings.push(String(data.safetyRestriction));
  return [...new Set(warnings.filter(Boolean))];
}

function normalizeRefresh(data = {}) {
  const refresh = [];
  if (Array.isArray(data.refresh)) {
    for (const target of data.refresh) {
      if (NATIVE_REFRESH_TARGETS.has(target)) refresh.push(target);
    }
  }
  if (!refresh.length) {
    if (data.tab) refresh.push("tabs");
    if (data.result || data.copyText || data.download || data.serverPath) refresh.push("state");
  }
  return [...new Set(refresh)];
}

function nativeParityMeta(surface) {
  if (!surface) return undefined;
  return {
    webStatus: surface.webStatus,
    priority: surface.priority,
    sensitive: surface.sensitive === true,
    guards: Array.isArray(surface.guards) ? surface.guards : [],
  };
}

export function nativeCommandResponse(command, data = {}, matrix) {
  const surface = nativeParitySurfaceForCommand(command, matrix);
  const status = NATIVE_COMMAND_STATUSES.has(data.status) ? data.status : defaultStatusForSurface(surface);
  const level = NATIVE_RESPONSE_LEVELS.has(data.level) ? data.level : defaultLevelForStatus(status);
  const cards = normalizeCards({ ...data, command, status, level });
  const toasts = normalizeToasts(data);
  const warnings = normalizeWarnings(data);
  const refresh = normalizeRefresh(data);
  const message = data.message || cards[0]?.content || "";

  const payload = {
    command,
    status,
    level,
    message,
    nativeParity: nativeParityMeta(surface),
    cards,
    toasts,
    warnings,
    refresh,
  };

  for (const [key, value] of Object.entries(data)) {
    if (["status", "level", "message", "cards", "toasts", "warnings", "refresh"].includes(key)) continue;
    if (value !== undefined) payload[key] = value;
  }

  return rpcSuccess("native_slash_command", payload);
}

export function nativeCommandUnavailable(command, details = {}, matrix) {
  const surface = nativeParitySurfaceForCommand(command, matrix);
  const guards = Array.isArray(surface?.guards) ? surface.guards.filter((guard) => guard !== "none") : [];
  const reason = details.reason || surface?.currentBehavior || "This native Pi TUI command is not implemented in the Web UI yet.";
  const nextActions = details.nextActions || [
    surface?.targetBehavior ? `Planned Web UI behavior: ${surface.targetBehavior}` : "Use the Pi TUI for this command until Web UI parity is implemented.",
  ];
  return nativeCommandResponse(
    command,
    {
      status: "unavailable",
      level: "warn",
      reason,
      safetyRestriction: details.safetyRestriction || (guards.length ? `Guarded by: ${guards.join(", ")}.` : undefined),
      nextActions,
      message: details.message || [`/${command} is not available in the Web UI yet.`, reason, ...nextActions].filter(Boolean).join("\n"),
      refresh: details.refresh,
      ...details,
    },
    matrix,
  );
}

export function nativeCommandBlocked(command, req, matrix, options = {}) {
  const guards = guardsForNativeCommand(command, matrix);
  const evaluation = evaluateTrustGuards(guards, {
    isLocal: isLocalRequest(req),
    confirmed: options.confirmed === true,
    networkOpen: options.networkOpen === true,
  });
  return nativeCommandResponse(
    command,
    {
      status: "blocked",
      level: "error",
      reason: trustBlockMessage(command, evaluation.blocked),
      safetyRestriction: evaluation.blocked.length ? `Blocked guards: ${evaluation.blocked.join(", ")}.` : undefined,
      warnings: evaluation.warnings,
      message: trustBlockMessage(command, evaluation.blocked),
      refresh: [],
    },
    matrix,
  );
}

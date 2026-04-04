const ALLOWED_REDIRECT_PREFIXES = [
  "/dashboard",
  "/plan",
  "/calendar",
  "/coach",
  "/settings",
  "/sessions",
  "/activities",
  "/debrief"
];

export function sanitizeRedirectPath(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/dashboard";
  }

  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes("\\") || decoded.startsWith("//")) {
      return "/dashboard";
    }
    if (!ALLOWED_REDIRECT_PREFIXES.some((p) => decoded.startsWith(p))) {
      return "/dashboard";
    }
  } catch {
    return "/dashboard";
  }

  return path;
}

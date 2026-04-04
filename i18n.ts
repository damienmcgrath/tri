import { getRequestConfig } from "next-intl/server";
import { defaultLocale, resolveLocale } from "@/lib/i18n/config";

/**
 * next-intl request configuration.
 *
 * Since tri.ai does not use locale-based URL routing, the locale is
 * determined from a cookie or the user's profile (defaulting to 'en').
 * The cookie name matches what we set in middleware.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = resolveLocale(requested ?? defaultLocale);

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});

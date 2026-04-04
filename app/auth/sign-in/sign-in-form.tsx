"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { sanitizeRedirectPath } from "@/lib/security/redirect";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingLink, setIsSendingLink] = useState(false);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    const messageParam = searchParams.get("message");

    if (errorParam) {
      setError(errorParam);
    }

    if (messageParam) {
      setMessage(messageParam);
    }
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setIsSubmitting(false);
      return;
    }

    const nextPath = sanitizeRedirectPath(searchParams.get("next"));
    router.push(nextPath);
    router.refresh();
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email address first.");
      setMessage(null);
      return;
    }

    setError(null);
    setMessage(null);
    setIsSendingLink(true);

    const supabase = createClient();
    const nextPath = sanitizeRedirectPath(searchParams.get("next"));
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", nextPath);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString()
      }
    });

    if (otpError) {
      setError(otpError.message);
      setIsSendingLink(false);
      return;
    }

    setMessage("Check your email for a sign-in link.");
    setIsSendingLink(false);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="label-base" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="input-base"
        />
      </div>

      <div className="space-y-2">
        <label className="label-base" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="input-base"
        />
      </div>

      <div className="flex justify-end">
        <Link href="/auth/forgot-password" className="text-sm font-medium text-accent hover:text-white">
          I forgot my password
        </Link>
      </div>

      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}

      <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:opacity-70">
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>

      <button
        type="button"
        onClick={handleMagicLink}
        disabled={isSendingLink || isSubmitting}
        className="btn-secondary w-full disabled:opacity-70"
      >
        {isSendingLink ? "Sending link..." : "Email me a sign-in link"}
      </button>

      <p className="text-center text-sm text-muted">
        Need an account?{" "}
        <Link href="/auth/sign-up" className="font-medium text-accent hover:text-white">
          Sign up
        </Link>
      </p>
    </form>
  );
}

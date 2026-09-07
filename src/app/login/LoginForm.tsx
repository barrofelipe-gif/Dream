"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/hub";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("E-mail ou senha incorretos.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[#8b9389]" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-[#2a322c] bg-[#070907] px-3 py-2.5 text-sm text-[#e9ede8] outline-none placeholder:text-[#4f574f] focus:border-[#3ad0a8] focus:ring-2 focus:ring-[#3ad0a8]/20"
          placeholder="voce@exemplo.com"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-[#8b9389]" htmlFor="password">
          Senha
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-[#2a322c] bg-[#070907] px-3 py-2.5 text-sm text-[#e9ede8] outline-none placeholder:text-[#4f574f] focus:border-[#3ad0a8] focus:ring-2 focus:ring-[#3ad0a8]/20"
          placeholder="••••••••"
        />
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[#3ad0a8] py-2.5 text-sm font-medium text-[#04120c] shadow-[0_0_20px_-4px_rgba(58,208,168,0.6)] transition-colors hover:bg-[#5ae1be] disabled:opacity-60"
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

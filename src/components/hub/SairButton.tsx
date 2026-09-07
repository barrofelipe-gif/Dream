"use client";

import { signOut } from "next-auth/react";

export default function SairButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-full border border-[#e3e5ea] px-3.5 py-1.5 text-xs font-medium text-[#5a5f6d] transition hover:border-[#c7cad1] hover:text-[#1b1f2b]"
    >
      Sair
    </button>
  );
}

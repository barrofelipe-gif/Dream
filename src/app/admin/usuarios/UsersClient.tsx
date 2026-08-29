"use client";

import { useState } from "react";
import Link from "next/link";
import { SECTORS, Sector } from "@/lib/sectors";
import { IconClose, IconTrash } from "@/components/icons";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "membro";
  sectors: Sector[];
}

interface UsersClientProps {
  initialUsers: UserRow[];
  currentUserId: string;
}

export default function UsersClient({ initialUsers, currentUserId }: UsersClientProps) {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [formOpen, setFormOpen] = useState(false);

  async function toggleSector(user: UserRow, sector: Sector) {
    const nextSectors = user.sectors.includes(sector)
      ? user.sectors.filter((s) => s !== sector)
      : [...user.sectors, sector];

    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, sectors: nextSectors } : u)));
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectors: nextSectors }),
    });
  }

  async function deleteUser(id: string) {
    if (!confirm("Excluir esse usuário?")) return;
    const prev = users;
    setUsers((cur) => cur.filter((u) => u.id !== id));
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (!res.ok) setUsers(prev);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/painel" className="text-sm text-zinc-500 hover:text-zinc-700">
            ← Voltar ao painel
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">Usuários e acesso por setor</h1>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Novo usuário
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
              <th className="px-4 py-3 font-medium">Pessoa</th>
              <th className="px-4 py-3 font-medium">Papel</th>
              {SECTORS.map((s) => (
                <th key={s.value} className="px-2 py-3 text-center font-medium" title={s.description}>
                  {s.label}
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-zinc-50 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{u.name}</p>
                  <p className="text-xs text-zinc-400">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-zinc-600">{u.role === "admin" ? "Admin" : "Membro"}</td>
                {SECTORS.map((s) => (
                  <td key={s.value} className="px-2 py-3 text-center">
                    <input
                      type="checkbox"
                      disabled={u.role === "admin"}
                      checked={u.role === "admin" || u.sectors.includes(s.value)}
                      onChange={() => toggleSector(u, s.value)}
                      className="h-4 w-4 accent-indigo-600 disabled:opacity-40"
                    />
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  {u.id !== currentUserId && (
                    <button
                      onClick={() => deleteUser(u.id)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-zinc-400">
        Admin sempre tem acesso a todos os setores — as caixinhas dele ficam marcadas e travadas.
      </p>

      {formOpen && (
        <NewUserForm
          onClose={() => setFormOpen(false)}
          onCreated={(user) => setUsers((prev) => [...prev, { ...user, sectors: user.sectors ?? [] }])}
        />
      )}
    </div>
  );
}

function NewUserForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: UserRow) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "membro">("membro");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(sector: Sector) {
    setSectors((prev) => (prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role, sectors }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Não deu pra criar o usuário.");
      return;
    }
    onCreated({ ...data, sectors });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <h2 className="text-base font-semibold text-zinc-900">Novo usuário</h2>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100">
              <IconClose />
            </button>
          </div>

          <div className="space-y-3 px-5 py-4">
            <input
              required
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <input
              required
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <input
              required
              type="password"
              placeholder="Senha inicial"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "membro")}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            >
              <option value="membro">Membro (acesso por setor)</option>
              <option value="admin">Admin (acesso total)</option>
            </select>

            {role === "membro" && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-600">Setores liberados</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SECTORS.map((s) => (
                    <label key={s.value} className="flex items-center gap-1.5 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={sectors.includes(s.value)}
                        onChange={() => toggle(s.value)}
                        className="h-4 w-4 accent-indigo-600"
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-4">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Criando..." : "Criar usuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

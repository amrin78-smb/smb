import React, { useState } from "react";

const HARDCODED_USER = "amedsmb";       // 👈 change me
const HARDCODED_PASS = "Amed1920";   // 👈 change me
const KEY = "smb_login_ok";

export default function AuthGate({ children }) {
  const [ok, setOk] = useState(localStorage.getItem(KEY) === "yes");
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");

  if (ok) return children;

  const onSubmit = (e) => {
    e.preventDefault();
    if (u === HARDCODED_USER && p === HARDCODED_PASS) {
      localStorage.setItem(KEY, "yes");
      setOk(true);
    } else {
      setErr("Invalid username or password");
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Logo */}
        <img
          src="/logo.png"
          alt="Selera Malaysia Bangkok"
          className="h-16 w-16 mb-4"
        />

        {/* Welcome text */}
        <h1 className="text-center text-lg font-semibold mb-6">
          Welcome to Selera Malaysia Bangkok<br />
          Inventory and Ordering System
        </h1>

        {/* Login box */}
        <form
          onSubmit={onSubmit}
          className="bg-white border rounded-2xl shadow p-6 w-full"
        >
          <label className="text-sm">Username</label>
          <input
            className="w-full border rounded-lg p-2 mb-3"
            value={u}
            onChange={(e) => setU(e.target.value)}
          />

          <label className="text-sm">Password</label>
          <input
            type="password"
            className="w-full border rounded-lg p-2 mb-4"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />

          {err && <div className="text-red-600 text-sm mb-3">{err}</div>}

          <button className="w-full py-2 rounded-xl border bg-gray-50 hover:shadow">
            Log in
          </button>
        </form>
      </div>
    </div>
  );
}

export function LogoutButton() {
  return (
    <button
      onClick={() => {
        localStorage.removeItem(KEY);
        location.reload();
      }}
      className="px-3 py-1 rounded-lg border bg-gray-50 text-sm"
    >
      Logout
    </button>
  );
}

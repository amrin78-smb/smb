import React, { useEffect, useState } from "react";
import { listProducts, createProduct, updateProduct, deleteProduct } from "../api";
import { useFuzzy, formatTHB } from "../utils/format";

const Section = ({ title, right, children }) => (
  <div className="w-full max-w-6xl mx-auto my-4 sm:my-6 p-4 sm:p-5 rounded-2xl shadow border bg-white">
    <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
      <h2 className="text-lg sm:text-xl font-semibold">{title}</h2>
      <div className="min-w-0">{right}</div>
    </div>
    {children}
  </div>
);
const Button = ({ children, className = "", ...props }) => (
  <button className={`px-3 py-2 rounded-xl border shadow-sm hover:shadow transition text-sm bg-gray-50 ${className}`} {...props}>
    {children}
  </button>
);
const Input = ({ className = "", ...props }) => (
  <input className={`px-3 py-2 rounded-xl border w-full focus:outline-none focus:ring ${className}`} {...props} />
);
const Label = ({ children }) => (<label className="text-sm text-gray-600">{children}</label>);

export default function Products() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", price: "" });
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: "", price: 0 });
  const [error, setError] = useState(null);

  const refresh = async () => { setError(null); setList(await listProducts()); };
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  const filtered = useFuzzy(list, ["name"], q);

  async function add() {
    if (!form.name) return alert("Name required");
    await createProduct({ name: form.name, price: Number(form.price || 0) });
    setForm({ name: "", price: "" }); refresh();
  }
  function startEdit(p) { setEditId(p.id); setEditDraft({ name: p.name ?? "", price: p.price ?? 0 }); }
  async function saveEdit(id) { await updateProduct({ id, name: editDraft.name ?? "", price: Number(editDraft.price || 0) }); setEditId(null); refresh(); }
  async function remove(id) { if (confirm("Delete product?")) { await deleteProduct(id); refresh(); } }

  return (
    <Section title="Products" right={<Input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} className="w-[180px] sm:w-[240px]" />}>
      {error && <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">⚠️ {error}</div>}
      <div className="grid grid-cols-12 gap-3 mb-3">
        <div className="col-span-12 sm:col-span-8"><Label>Name</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-2"><Label>Price</Label><Input type="number" value={form.price} onChange={e=>setForm({...form,price:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-2 flex items-end"><Button className="w-full" onClick={add}>Add</Button></div>
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left border-b"><th className="p-2">Name</th><th className="p-2">Price</th><th className="p-2">Actions</th></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{editId===p.id ? <Input value={editDraft.name} onChange={e=>setEditDraft({...editDraft,name:e.target.value})} /> : p.name}</td>
                <td className="p-2">{editId===p.id ? <Input type="number" value={editDraft.price} onChange={e=>setEditDraft({...editDraft,price:e.target.value})} /> : formatTHB(p.price)}</td>
                <td className="p-2 flex gap-2">
                  {editId===p.id ? <><Button onClick={()=>saveEdit(p.id)}>Save</Button><Button onClick={()=>setEditId(null)}>Cancel</Button></>
                  : <><Button onClick={()=>startEdit(p)}>Edit</Button><Button onClick={()=>remove(p.id)}>Delete</Button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

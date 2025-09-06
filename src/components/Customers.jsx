import React, { useEffect, useState } from "react";
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from "../api";
import { useFuzzy } from "../utils/format";

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

export default function Customers() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" });
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: "", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" });

  const refresh = async () => setList(await listCustomers());
  useEffect(() => { refresh().catch(console.error); }, []);
  const filtered = useFuzzy(list, ["name","phone","address","grabwin","grabcar","nationality"], q);

  async function add() {
    if (!form.name) return alert("Name required");
    await createCustomer(form);
    setForm({ name: "", phone: "", address: "", grabwin: "", grabcar: "", nationality: "" });
    refresh();
  }
  function startEdit(c) { setEditId(c.id); setEditDraft({ name: c.name ?? "", phone: c.phone ?? "", address: c.address ?? "", grabwin: c.grabwin ?? "", grabcar: c.grabcar ?? "", nationality: c.nationality ?? "" }); }
  async function saveEdit(id) { await updateCustomer({ id, ...editDraft }); setEditId(null); refresh(); }
  async function remove(id) { if (confirm("Delete customer?")) { await deleteCustomer(id); refresh(); } }

  return (
    <Section title="Customers" right={<Input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} className="w-[180px] sm:w-[240px]" />}>
      <div className="grid grid-cols-12 gap-3 mb-3">
        <div className="col-span-12 sm:col-span-3"><Label>Name</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-2"><Label>Phone</Label><Input inputMode="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></div>
        <div className="col-span-12 sm:col-span-3"><Label>Address</Label><Input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-1"><Label>GrabWin</Label><Input value={form.grabwin} onChange={e=>setForm({...form,grabwin:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-1"><Label>GrabCar</Label><Input value={form.grabcar} onChange={e=>setForm({...form,grabcar:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-2"><Label>Nationality</Label><Input value={form.nationality} onChange={e=>setForm({...form,nationality:e.target.value})} /></div>
        <div className="col-span-6 sm:col-span-2 flex items-end"><Button className="w-full" onClick={add}>Add</Button></div>
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left border-b">
            <th className="p-2">Name</th>
            <th className="p-2">Phone</th>
            <th className="p-2 hidden md:table-cell">Address</th>
            <th className="p-2 hidden md:table-cell">GrabWin</th>
            <th className="p-2 hidden md:table-cell">GrabCar</th>
            <th className="p-2 hidden md:table-cell">Nationality</th>
            <th className="p-2">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{editId===c.id ? <Input value={editDraft.name} onChange={e=>setEditDraft({...editDraft,name:e.target.value})} /> : c.name}</td>
                <td className="p-2">{editId===c.id ? <Input inputMode="tel" value={editDraft.phone} onChange={e=>setEditDraft({...editDraft,phone:e.target.value})} /> : c.phone}</td>
                <td className="p-2 hidden md:table-cell">{editId===c.id ? <Input value={editDraft.address} onChange={e=>setEditDraft({...editDraft,address:e.target.value})} /> : c.address}</td>
                <td className="p-2 hidden md:table-cell">{editId===c.id ? <Input value={editDraft.grabwin} onChange={e=>setEditDraft({...editDraft,grabwin:e.target.value})} /> : c.grabwin}</td>
                <td className="p-2 hidden md:table-cell">{editId===c.id ? <Input value={editDraft.grabcar} onChange={e=>setEditDraft({...editDraft,grabcar:e.target.value})} /> : c.grabcar}</td>
                <td className="p-2 hidden md:table-cell">{editId===c.id ? <Input value={editDraft.nationality} onChange={e=>setEditDraft({...editDraft,nationality:e.target.value})} /> : c.nationality}</td>
                <td className="p-2 flex gap-2">
                  {editId===c.id ? <><Button onClick={()=>saveEdit(c.id)}>Save</Button><Button onClick={()=>setEditId(null)}>Cancel</Button></>
                  : <><Button onClick={()=>startEdit(c)}>Edit</Button><Button onClick={()=>remove(c.id)}>Delete</Button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

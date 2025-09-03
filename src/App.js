import React, { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import SignatureCanvas from "react-signature-canvas";

// ====== CONFIG ======
const API_URL = process.env.REACT_APP_API_URL || "https://bluehome-ot-backend.up.railway.app";

// ====== HELPERS ======
const STATUS = {
  NEW: "Pendiente de asignación",
  IN_PROGRESS: "En proceso",
  DONE_WAITING_SIGN: "Finalizada (pendiente firma)",
  CLOSED: "Cerrada con PDF",
};
const TYPE_OPTIONS = [
  { value: "reparacion", label: "Reparación" },
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "otro", label: "Otro" },
];

async function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function getUploadUrl(contentType, withAuth=false) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (withAuth) {
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const r = await fetch(`${API_URL}/api/upload-url`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contentType })
    });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch (e) {
    return null; // fallback to base64
  }
}

async function authorizedFetch(path, opts={}) {
  const token = localStorage.getItem("token");
  return fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type":"application/json",
      ...(opts.headers||{}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}

// ====== APP ======
export default function App() {
  const [route, setRoute] = useState("inquilino"); // inquilino | admin | tecnico
  return (
    <>
      <div className="header">
        <div className="header-inner">
          <div style={{width:40,height:40,borderRadius:12,background:"#0284c7"}}/>
          <div>
            <div style={{fontWeight:700}}>Blue Home Inmobiliaria</div>
            <div className="small">Órdenes de Trabajo conectadas a backend</div>
          </div>
          <div className="tabs">
            <button className={`tab ${route==="inquilino"?"active":""}`} onClick={()=>setRoute("inquilino")}>Radicar (Inquilino)</button>
            <button className={`tab ${route==="admin"?"active":""}`} onClick={()=>setRoute("admin")}>Órdenes (Admin)</button>
            <button className={`tab ${route==="tecnico"?"active":""}`} onClick={()=>setRoute("tecnico")}>Técnicos</button>
          </div>
        </div>
      </div>

      <div className="container">
        <AuthBar/>
        {route==="inquilino" && <TenantForm/>}
        {route==="admin" && <AdminBoard/>}
        {route==="tecnico" && <TechBoard/>}
        <div className="small" style={{textAlign:"center",marginTop:16}}>Archivos en S3 (si hay credenciales) o base64 provisional. PDFs por email y carga a S3.</div>
      </div>
    </>
  );
}

// ====== AUTH BAR ======
function AuthBar() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(localStorage.getItem("token") || "");

  async function login() {
    const r = await fetch(`${API_URL}/api/login`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ username, password })
    });
    const j = await r.json();
    if (j.token) {
      localStorage.setItem("token", j.token);
      setToken(j.token);
      alert("Ingreso exitoso.");
    } else {
      alert(j.error || "No se pudo iniciar sesión.");
    }
  }
  function logout() {
    localStorage.removeItem("token");
    setToken("");
  }

  return (
    <div className="card toolbar">
      <span className="small">API: {API_URL}</span>
      <div className="right"/>
      {token ? (
        <>
          <span className="badge">Conectado</span>
          <button className="btn secondary" onClick={logout}>Salir</button>
        </>
      ):(
        <>
          <input className="input" placeholder="Usuario (admin / tecnico)" value={username} onChange={e=>setUsername(e.target.value)} style={{maxWidth:200}}/>
          <input className="input" placeholder="Contraseña" type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{maxWidth:200}}/>
          <button className="btn" onClick={login}>Ingresar</button>
        </>
      )}
    </div>
  );
}

// ====== TENANT FORM ======
function TenantForm(){
  const [form, setForm] = useState({ codigo:"", nombre:"", telefono:"", email:"", tipo:"reparacion", descripcion:"" });
  const [imgs, setImgs] = useState([]); // [{url}|{base64}]
  const [video, setVideo] = useState(null); // {url}|{base64}
  const [radicado, setRadicado] = useState(null);
  const [notify, setNotify] = useState({use:false, apiKey:"", userId:""});

  const onChange = e => setForm(prev=>({ ...prev, [e.target.name]: e.target.value }));

  const uploadSmart = async (file, requireAuth=false) => {
    // Try S3 signed URL, else fallback to base64
    const ps = await getUploadUrl(file.type, requireAuth);
    if (ps && ps.uploadUrl && ps.publicUrl) {
      await fetch(ps.uploadUrl, { method:"PUT", body:file });
      return { url: ps.publicUrl };
    }
    const base64 = await fileToDataURL(file);
    return { base64 };
  };

  const handleImg = async (e) => {
    const files = Array.from(e.target.files||[]).slice(0,2);
    const out = [];
    for (const f of files) out.push(await uploadSmart(f,false));
    setImgs(out);
  };
  const handleVideo = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setVideo(await uploadSmart(f,false));
  };

  async function submit(){
    if (!form.codigo || !form.nombre || !form.telefono || !form.descripcion) {
      alert("Completa código, nombre, teléfono y descripción."); return;
    }
    const r = await fetch(`${API_URL}/api/orders`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ ...form, imgs, video })
    });
    const j = await r.json();
    if (j.error) return alert(j.error);
    setRadicado(j.radicado);

    if (notify.use && notify.apiKey && notify.userId) {
      try {
        await fetch(`${API_URL}/api/notify-manychat`, {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ text:`Nueva orden ${j.radicado} registrada`, userId: notify.userId, apiKey: notify.apiKey })
        });
      } catch {}
    }

    setForm({ codigo:"", nombre:"", telefono:"", email:"", tipo:"reparacion", descripcion:"" });
    setImgs([]); setVideo(null);
  }

  return (
    <div className="card">
      <h2>Radicar solicitud de reparación</h2>
      <div className="row">
        <Input label="Código del inmueble" name="codigo" value={form.codigo} onChange={onChange}/>
        <Select label="Tipo" name="tipo" value={form.tipo} onChange={onChange} options={TYPE_OPTIONS}/>
        <Input label="Nombre del inquilino" name="nombre" value={form.nombre} onChange={onChange}/>
        <Input label="Teléfono" name="telefono" value={form.telefono} onChange={onChange}/>
        <Input label="Correo (opcional)" name="email" value={form.email} onChange={onChange}/>
        <Textarea label="Descripción del daño / solicitud" name="descripcion" value={form.descripcion} onChange={onChange}/>
        <div>
          <label className="small">Fotos (máx. 2)</label>
          <input type="file" accept="image/*" multiple onChange={handleImg}/>
        </div>
        <div>
          <label className="small">Video (opcional)</label>
          <input type="file" accept="video/*" onChange={handleVideo}/>
        </div>
      </div>

      <hr className="sep"/>
      <details>
        <summary className="small">Notificar ManyChat (opcional)</summary>
        <div className="row">
          <label className="small"><input type="checkbox" checked={notify.use} onChange={e=>setNotify(v=>({...v,use:e.target.checked}))}/> Usar notificación</label>
          <Input label="API Key" value={notify.apiKey} onChange={e=>setNotify(v=>({...v,apiKey:e.target.value}))}/>
          <Input label="User ID" value={notify.userId} onChange={e=>setNotify(v=>({...v,userId:e.target.value}))}/>
        </div>
      </details>

      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12}}>
        <button className="btn" onClick={submit}>Generar radicado</button>
      </div>

      {radicado && <div className="card"><div className="small">Radicado creado:</div><div className="mono">{radicado}</div></div>}
    </div>
  );
}

// ====== ADMIN BOARD ======
function AdminBoard(){
  const [orders,setOrders] = useState([]);
  const [q,setQ] = useState("");

  async function load(){
    const r = await authorizedFetch("/api/orders");
    if (r.ok) setOrders(await r.json());
    else alert("Inicia sesión (admin/tecnico) para ver órdenes.");
  }
  useEffect(()=>{ load(); },[]);

  const filtered = orders.filter(o => (o.radicado+" "+o.tenant?.codigo+" "+o.tenant?.nombre+" "+o.status).toLowerCase().includes(q.toLowerCase()));

  async function changeStatus(id, status){
    const r = await authorizedFetch(`/api/orders/${id}`, { method:"PATCH", body:JSON.stringify({ status }) });
    if (r.ok){ load(); } else alert("No se pudo actualizar");
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2>Órdenes (Admin)</h2>
        <div className="right"/>
        <input className="input" placeholder="Buscar..." value={q} onChange={e=>setQ(e.target.value)} style={{maxWidth:240}}/>
        <button className="btn secondary" onClick={load}>Refrescar</button>
      </div>
      <div className="grid">
        {filtered.map(o => (
          <div key={o.id} className="card">
            <div className="toolbar">
              <span className="mono">{o.radicado}</span>
              <span className="badge">{o.status}</span>
              {o.assignedTo && <span className="small">Asignada a: <b>{o.assignedTo}</b></span>}
              <div className="right small">{new Date(o.createdAt).toLocaleString()}</div>
            </div>
            <div className="row">
              <div>
                <p className="small"><b>Código:</b> {o.tenant?.codigo}</p>
                <p className="small"><b>Inquilino:</b> {o.tenant?.nombre}</p>
                <p className="small"><b>Tel:</b> {o.tenant?.telefono}</p>
              </div>
              <div>
                <p className="small"><b>Tipo:</b> {o.tenant?.tipo}</p>
                <p className="small"><b>Email:</b> {o.tenant?.email || "—"}</p>
              </div>
            </div>
            <p className="small"><b>Descripción:</b> {o.tenant?.descripcion}</p>

            {o.attachments?.imgs?.length>0 && (
              <div className="toolbar" style={{marginTop:8}}>
                {o.attachments.imgs.map((im,idx)=> <img key={idx} className="thumb" src={im.url || im.data || im.base64} alt="img"/>)}
              </div>
            )}
            {o.attachments?.video && (
              <details><summary className="small">Ver video</summary><video controls style={{width:"100%",borderRadius:12,border:"1px solid #e2e8f0"}} src={o.attachments.video.url || o.attachments.video.base64}/></details>
            )}

            <div className="actions" style={{marginTop:8}}>
              <select className="input" value={o.status} onChange={(e)=>changeStatus(o.id, e.target.value)}>
                {Object.values(STATUS).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ====== TECH BOARD ======
function TechBoard(){
  const [orders,setOrders] = useState([]);
  const [me,setMe] = useState("");
  const [hasToken,setHasToken] = useState(!!localStorage.getItem("token"));

  async function load(){
    const r = await authorizedFetch("/api/orders");
    if (r.ok) setOrders(await r.json());
    else alert("Inicia sesión como técnico para ver órdenes.");
  }
  useEffect(()=>{ load(); setHasToken(!!localStorage.getItem("token")); },[]);

  const my = orders.filter(o => o.assignedTo === me);
  const available = orders.filter(o => !o.assignedTo && o.status === STATUS.NEW);

  async function takeOrder(id){
    const r = await authorizedFetch(`/api/orders/${id}`, { method:"PATCH", body:JSON.stringify({ assignedTo: me, status: STATUS.IN_PROGRESS }) });
    if (r.ok) load(); else alert("No se pudo tomar");
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2>Portal Técnicos</h2>
        <div className="right"/>
        {!hasToken && <span className="small">Debes iniciar sesión arriba (usuario <b>tecnico</b>)</span>}
      </div>

      <div className="row">
        <Input label="Tu nombre para asignación" value={me} onChange={e=>setMe(e.target.value)}/>
      </div>

      <h3>Órdenes disponibles</h3>
      <div className="grid">
        {available.map(o => (
          <div key={o.id} className="card">
            <div className="toolbar">
              <span className="mono">{o.radicado}</span>
              <span className="badge">{o.status}</span>
              <div className="right small">{new Date(o.createdAt).toLocaleString()}</div>
            </div>
            <p className="small"><b>Inquilino:</b> {o.tenant?.nombre} — {o.tenant?.telefono}</p>
            <button className="btn" disabled={!me} onClick={()=>takeOrder(o.id)}>Tomar orden</button>
          </div>
        ))}
      </div>

      <h3>Mis órdenes</h3>
      <div className="grid">
        {my.map(o => <WorkCard key={o.id} order={o} me={me} reload={load}/>)}
      </div>
    </div>
  );
}

function WorkCard({ order, me, reload }){
  const [before,setBefore] = useState(order.work?.before||[]);
  const [during,setDuring] = useState(order.work?.during||[]);
  const [after,setAfter] = useState(order.work?.after||[]);
  const [materials,setMaterials] = useState(order.work?.materials||"");
  const [notes,setNotes] = useState(order.work?.notes||"");
  const sigRef = useRef(null);
  const [sigData,setSigData] = useState(order.signature||null);
  const [email,setEmail] = useState(order.tenant?.email||"");

  const uploadAuth = async (file) => {
    const ps = await getUploadUrl(file.type, true);
    if (ps && ps.uploadUrl && ps.publicUrl) {
      await fetch(ps.uploadUrl, { method:"PUT", body:file });
      return { url: ps.publicUrl };
    }
    const base64 = await fileToDataURL(file);
    return { base64 };
  };

  const pickImgs = async (setter, e, limit=10) => {
    const files = Array.from(e.target.files||[]).slice(0,limit);
    const out = [...setter===setBefore?before:setter===setDuring?during:after];
    for (const f of files) out.push(await uploadAuth(f));
    setter(out);
  };

  async function persist(next){
    const r = await authorizedFetch(`/api/orders/${order.id}`, { method:"PATCH", body:JSON.stringify(next) });
    if (!r.ok) alert("No se guardó"); else reload();
  }

  function captureSig(){
    if (!sigRef.current || sigRef.current.isEmpty()) { alert("Firma vacía"); return; }
    const d = sigRef.current.getTrimmedCanvas().toDataURL("image/png");
    setSigData(d);
    persist({ signature: d });
  }

  async function saveWork(){
    await persist({ work: { before, during, after, materials, notes }, status: STATUS.DONE_WAITING_SIGN });
    alert("Trabajo guardado. Estado: Finalizada (pend. firma)");
  }

  async function generatePDF(){
    const doc = new jsPDF({ unit:"pt", format:"a4" });
    const margin = 40;
    let y = margin;
    const W = doc.internal.pageSize.getWidth();

    const text = (t, inc=14, size=10) => { doc.setFontSize(size); doc.text(t, margin, y); y += inc; };
    doc.setFontSize(16);
    text("Blue Home Inmobiliaria — Acta de Trabajo", 18, 16);
    text(`Radicado: ${order.radicado}`);
    text(`Fecha: ${new Date().toLocaleString()}`);
    text(`Técnico: ${me || order.assignedTo || "—"}`);
    text(`Estado: ${order.status}`);
    text(`Código Inmueble: ${order.tenant?.codigo}`);
    text(`Inquilino: ${order.tenant?.nombre} — Tel: ${order.tenant?.telefono}`);
    y += 6; text("Descripción de la solicitud:", 14, 12);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(order.tenant?.descripcion||"", W - margin*2);
    doc.text(lines, margin, y); y += 14 + lines.length*10;

    const addGallery = (title, arr) => {
      if (!arr?.length) return;
      if (y > 740) { doc.addPage(); y = margin; }
      doc.setFontSize(12); doc.text(title, margin, y); y += 8;
      const size = 140, gap = 10; let x = margin;
      arr.forEach(img => {
        if (y > 760) { doc.addPage(); y = margin; x = margin; }
        const src = img.url || img.base64 || img.data;
        doc.addImage(src, "JPEG", x, y, size, size);
        x += size + gap;
        if (x + size > W - margin) { x = margin; y += size + gap; }
      });
      y += 6;
    };
    addGallery("Antes:", before);
    addGallery("Durante:", during);
    addGallery("Después:", after);

    if (y > 740) { doc.addPage(); y = margin; }
    doc.setFontSize(12); doc.text("Materiales utilizados:", margin, y); y += 12;
    doc.setFontSize(10); const m = doc.splitTextToSize(materials||"—", W - margin*2); doc.text(m, margin, y); y += 12 + m.length*10;

    if (y > 740) { doc.addPage(); y = margin; }
    doc.setFontSize(12); doc.text("Observaciones del técnico:", margin, y); y += 12;
    doc.setFontSize(10); const n = doc.splitTextToSize(notes||"—", W - margin*2); doc.text(n, margin, y); y += 12 + n.length*10;

    if (sigData) {
      if (y > 640) { doc.addPage(); y = margin; }
      doc.setFontSize(12); doc.text("Firma del inquilino:", margin, y); y += 6;
      doc.addImage(sigData, "PNG", margin, y, 220, 110); y += 120;
    } else {
      doc.setFontSize(10); doc.text("(Sin firma — pendiente)", margin, y); y += 14;
    }

    const blob = doc.output("blob");
    const pdfBase64 = doc.output("datauristring"); // for email

    // Try upload PDF to S3 and save pdfUrl
    try {
      const file = new File([blob], `Acta_${order.radicado}.pdf`, { type:"application/pdf" });
      const ps = await getUploadUrl("application/pdf", true);
      if (ps?.uploadUrl && ps?.publicUrl) {
        await fetch(ps.uploadUrl, { method:"PUT", body:file });
        await persist({ pdfUrl: ps.publicUrl, status: STATUS.CLOSED });
      } else {
        await persist({ status: STATUS.CLOSED });
      }
    } catch {
      await persist({ status: STATUS.CLOSED });
    }

    // Ask to email
    if (email) {
      try {
        const r = await authorizedFetch("/api/send-pdf", { method:"POST", body:JSON.stringify({ orderId: order.id, toEmail: email, pdfBase64 }) });
        const j = await r.json();
        if (j.preview) alert("PDF enviado. Vista previa (Ethereal): " + j.preview);
        else alert("PDF enviado.");
      } catch { alert("No se pudo enviar el PDF por email"); }
    } else {
      alert("PDF generado y orden cerrada (sin email).");
    }
  }

  return (
    <div className="card">
      <div className="toolbar">
        <span className="mono">{order.radicado}</span>
        <span className="badge">{order.status}</span>
        <div className="right small">{new Date(order.createdAt).toLocaleString()}</div>
      </div>

      <div className="row">
        <div>
          <label className="small">Fotos ANTES</label>
          <input type="file" multiple accept="image/*" onChange={(e)=>pickImgs(setBefore,e)}/>
          <div className="toolbar">{before.map((im,i)=><img key={i} className="thumb" src={im.url||im.base64||im.data} alt="b"/>)}</div>
        </div>
        <div>
          <label className="small">Fotos DURANTE</label>
          <input type="file" multiple accept="image/*" onChange={(e)=>pickImgs(setDuring,e)}/>
          <div className="toolbar">{during.map((im,i)=><img key={i} className="thumb" src={im.url||im.base64||im.data} alt="d"/>)}</div>
        </div>
        <div>
          <label className="small">Fotos DESPUÉS</label>
          <input type="file" multiple accept="image/*" onChange={(e)=>pickImgs(setAfter,e)}/>
          <div className="toolbar">{after.map((im,i)=><img key={i} className="thumb" src={im.url||im.base64||im.data} alt="a"/>)}</div>
        </div>
      </div>

      <div className="row">
        <Textarea label="Materiales usados" value={materials} onChange={e=>setMaterials(e.target.value)}/>
        <Textarea label="Observaciones del técnico" value={notes} onChange={e=>setNotes(e.target.value)}/>
      </div>

      <div className="row">
        <div className="card">
          <div className="small"><b>Firma del inquilino</b></div>
          <SignatureCanvas ref={sigRef} canvasProps={{className:"sig", style:{width:"100%",height:160,border:"1px solid #e2e8f0",borderRadius:12}}} penColor="#0f172a" />
          <div className="actions" style={{marginTop:8}}>
            <button className="btn secondary" onClick={()=>{sigRef.current?.clear(); setSigData(null);}}>Limpiar</button>
            <button className="btn" onClick={captureSig}>Guardar firma</button>
          </div>
          {sigData && <img src={sigData} alt="firma" style={{marginTop:8,height:80}}/>}
        </div>
        <div className="card">
          <Input label="Enviar PDF a este correo" value={email} onChange={e=>setEmail(e.target.value)}/>
          <div className="actions" style={{marginTop:8}}>
            <button className="btn secondary" onClick={saveWork}>Guardar (pend. firma)</button>
            <button className="btn" onClick={generatePDF}>Generar PDF y Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ====== UI helpers ======
function Input({ label, ...props }) { return <label className="small"><div>{label}</div><input className="input" {...props} /></label>; }
function Textarea({ label, ...props }) { return <label className="small"><div>{label}</div><textarea className="input" rows={5} {...props} /></label>; }
function Select({ label, name, value, onChange, options }) {
  return <label className="small"><div>{label}</div><select className="input" name={name} value={value} onChange={onChange}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}

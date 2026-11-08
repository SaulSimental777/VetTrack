import { useEffect, useId, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { fileSize, openStoredFile, readFileBlob, uploadFile } from '../lib/files'
import type { FileCategory, StoredFile } from '../lib/files'
export function FileLink({ id, legacyUrl, label='Ver archivo' }: { id?: string | null; legacyUrl?: string | null; label?: string }) {
 const [error,setError]=useState('');const [pending,setPending]=useState(false)
 if(!id&&!legacyUrl)return null
 return <span className="file-link">{id?<button type="button" className="users-link-button" disabled={pending} onClick={async()=>{setPending(true);setError('');try{await openStoredFile(id)}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo abrir el archivo.')}finally{setPending(false)}}}>{pending?'Abriendo…':label}</button>:legacyUrl?.startsWith('https://')?<a href={legacyUrl} target="_blank" rel="noopener noreferrer">{label}</a>:null}{error&&<span role="alert" className="users-field-error">{error}</span>}</span>
}
export function StoredImage({ id, alt, className }: { id?: string | null; alt: string; className?: string }) {
 const [preview,setPreview]=useState<{id:string;url:string}|null>(null)
 useEffect(()=>{if(!id)return;const controller=new AbortController();let url:string|undefined;readFileBlob(id,controller.signal).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setPreview({id,url})}).catch(()=>{});return()=>{controller.abort();if(url)URL.revokeObjectURL(url)}},[id])
 return preview&&preview.id===id?<img src={preview.url} alt={alt} className={className} onError={()=>setPreview(null)}/>:null
}
export function FileUpload({ label, category, contextId, value, onChange, legacyUrl, onLegacyChange, disabled=false, onBusyChange, persistedValue }: {
 label:string;category:FileCategory;contextId?:string;value:string|null;onChange:(id:string|null)=>void;legacyUrl?:string|null;onLegacyChange?:(url:null)=>void;disabled?:boolean;onBusyChange?:(busy:boolean)=>void;persistedValue?:string|null
}) {
 const inputId=useId(),input=useRef<HTMLInputElement>(null),request=useRef<AbortController|null>(null),staged=useRef<string|null>(null)
 const [file,setFile]=useState<StoredFile|null>(null),[candidate,setCandidate]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('')
 useEffect(()=>()=>request.current?.abort(),[])
 useEffect(()=>{if(!value||file?.id_archivo===value)return;const controller=new AbortController();apiFetch<StoredFile>(`/api/archivos/${value}/info`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setFile(data)}).catch(()=>{});return()=>controller.abort()},[value,file?.id_archivo])
 const choose=async(selected?:File)=>{
  if(!selected||busy||disabled)return
  request.current?.abort();const controller=new AbortController();request.current=controller;setCandidate(selected);setBusy(true);onBusyChange?.(true);setError('');setStatus('Validando y cargando archivo…')
  try{const uploaded=await uploadFile(selected,category,contextId,controller.signal);if(controller.signal.aborted)return;staged.current=uploaded.id_archivo;setFile(uploaded);onChange(uploaded.id_archivo);onLegacyChange?.(null);setStatus('Archivo listo. Guarda el formulario para vincularlo.');setCandidate(null)}
  catch(cause){if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'No se pudo cargar el archivo.');setStatus('La carga no se completó.')}}finally{if(!controller.signal.aborted){setBusy(false);onBusyChange?.(false)}}
 }
 const remove=async()=>{
  if(disabled||busy)return
  setError('')
  if(value&&staged.current===value&&value!==persistedValue){setBusy(true);onBusyChange?.(true);try{await apiFetch(`/api/archivos/${value}`,{method:'DELETE'})}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo quitar el archivo.');return}finally{setBusy(false);onBusyChange?.(false)}}
  onChange(null);onLegacyChange?.(null);setFile(null);setCandidate(null);setStatus('Se quitará al guardar el formulario.');if(input.current)input.current.value=''
 }
 return <section className="file-upload" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void choose(event.dataTransfer.files[0])}} aria-busy={busy}>
  <label htmlFor={inputId}>{label}</label><p className="users-help">{category==='logo'?'PNG o JPG/JPEG · máximo 5 MB':'PDF, PNG o JPG/JPEG · máximo 10 MB'}. Puedes seleccionar o arrastrar un archivo.</p>
  <input ref={input} id={inputId} type="file" accept={category==='logo'?'image/png,image/jpeg':'application/pdf,image/png,image/jpeg'} disabled={disabled||busy} onChange={event=>void choose(event.target.files?.[0])}/>
  {file&&file.id_archivo===value&&<p>{file.nombre} · {fileSize(file.tamano)} · {file.mime}</p>}
  {category==='logo'&&value&&<StoredImage id={value} alt="Vista previa del logo" className="clinic-logo-preview"/>}
  <div className="operations-actions"><FileLink id={value} legacyUrl={legacyUrl} label={category==='compras'?'Ver documento':'Ver archivo'}/>{(value||legacyUrl||candidate)&&<button type="button" className="users-secondary-button" disabled={disabled||busy} onClick={()=>void remove()}>Quitar archivo</button>}{(value||legacyUrl)&&<button type="button" className="users-secondary-button" disabled={disabled||busy} onClick={()=>input.current?.click()}>Reemplazar</button>}{candidate&&error&&<button type="button" className="users-secondary-button" disabled={busy||disabled} onClick={()=>void choose(candidate)}>Reintentar carga</button>}</div>
  {status&&<p role="status" className="users-help">{status}</p>}{error&&<p role="alert" className="users-field-error">{error}</p>}
 </section>
}

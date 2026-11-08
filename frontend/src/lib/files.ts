import { supabase } from './supabase'
import { ApiError, apiFetch } from './api'
export interface StoredFile { id_archivo: string; nombre: string; mime: string; tamano: number; estado: string }
export type FileCategory = 'logo' | 'compras' | 'estudios' | 'soporte'
export const fileSize = (bytes: number) => bytes < 1048576 ? `${Math.max(1,Math.round(bytes/1024))} KB` : `${(bytes/1048576).toFixed(1)} MB`
export async function readFileBlob(id: string, signal?: AbortSignal): Promise<Blob> {
 const {data:{session},error}=await supabase.auth.getSession()
 if(error||!session)throw new Error('No hay una sesión activa.')
 const response=await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/archivos/${id}`,{headers:{Authorization:`Bearer ${session.access_token}`},signal})
 if(!response.ok){const data=await response.json().catch(()=>null);throw new ApiError(data?.error||'No se pudo abrir el archivo.',response.status)}
 return response.blob()
}
export async function openStoredFile(id: string) {
 const popup=window.open('','_blank')
 try {const blob=await readFileBlob(id);const url=URL.createObjectURL(blob);if(popup)popup.location.href=url;else{const a=document.createElement('a');a.href=url;a.download='archivo';a.click()}setTimeout(()=>URL.revokeObjectURL(url),60000)}
 catch(error){popup?.close();throw error}
}
export async function uploadFile(file: File, category: FileCategory, contextId: string | undefined, signal: AbortSignal): Promise<StoredFile> {
 const max=category==='logo'?5242880:10485760
 if(!file.size||file.size>max)throw new Error(`Selecciona un archivo de hasta ${category==='logo'?5:10} MB.`)
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer())
 const type=String.fromCharCode(...bytes.slice(0,5))==='%PDF-'?'application/pdf':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null
 if(!type||(file.type&&file.type!==type)||(category==='logo'&&type==='application/pdf'))throw new Error(category==='logo'?'El logo debe ser una imagen PNG o JPG/JPEG.':'Selecciona un PDF, PNG o JPG/JPEG válido.')
 const reserved=await apiFetch<StoredFile>('/api/archivos',{method:'POST',signal,body:JSON.stringify({categoria:category,nombre:file.name,mime:type,tamano:file.size,...(contextId?{contexto_id:contextId}:{})})})
 return apiFetch<StoredFile>(`/api/archivos/${reserved.id_archivo}/contenido`,{method:'POST',body:file,headers:{'Content-Type':type},signal})
}

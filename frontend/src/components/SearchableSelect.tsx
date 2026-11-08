import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface SelectOption { value: string; label: string; description?: string; disabled?: boolean }
type ValueEvent = { target: { value: string } }
const text = (node: ReactNode): string => Children.toArray(node).map(item => isValidElement<{ children?: ReactNode }>(item) ? text(item.props.children) : typeof item === 'string' || typeof item === 'number' ? String(item) : '').join('')
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')

export function SearchableSelect({ id, value, onChange, onSearch, options, children, placeholder = 'Buscar y seleccionar…', disabled = false, required = false, loading = false, 'aria-label': ariaLabel }: {
  id?: string; value: string; onChange: (event: ValueEvent) => void; onSearch?: (query: string) => void; options?: SelectOption[]; children?: ReactNode; placeholder?: string; disabled?: boolean; required?: boolean; loading?: boolean; 'aria-label'?: string
}) {
  const generated = useId(); const inputId = id || generated; const listId = `${inputId}-options`
  const input = useRef<HTMLInputElement>(null); const container = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState<string | null>(null); const [open, setOpen] = useState(false); const [active, setActive] = useState(0)
  const [above, setAbove] = useState(false)
  const choices: SelectOption[] = options || Children.toArray(children).flatMap(child => isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child) && child.type === 'option' && child.props.value ? [{ value: String(child.props.value), label: text(child.props.children), disabled: child.props.disabled }] : [])
  const selected = choices.find(item => item.value === value)
  const filtered = choices.filter(item => normalize(`${item.label} ${item.description || ''}`).includes(normalize(query || '')))
  useEffect(() => {
    if (!open) return
    const position = () => { const rect = input.current?.getBoundingClientRect(); if (rect) setAbove(window.innerHeight - rect.bottom < 245 && rect.top > 245) }
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true)
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [open])
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, open, listId])
  useEffect(() => { input.current?.setCustomValidity(required && !value ? 'Selecciona una opción de la lista.' : '') }, [required, value])
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) { setOpen(false); setQuery(null) } }
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close)
  }, [])
  const choose = (option: SelectOption) => { if (option.disabled) return; onChange({ target: { value: option.value } }); setQuery(null); setOpen(false); input.current?.focus() }
  return <div className="searchable-select" ref={container}><div className="searchable-control"><input ref={input} id={inputId} role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined} autoComplete="off" value={query ?? selected?.label ?? ''} data-value={value} required={required} disabled={disabled} placeholder={placeholder} onClick={() => { if (!open) setQuery(''); setOpen(true) }} onFocus={() => { setOpen(true); setQuery(''); setActive(0) }} onBlur={() => { window.setTimeout(() => { if (!container.current?.contains(document.activeElement)) { setOpen(false); setQuery(null) } }, 0) }} onChange={event => { setQuery(event.target.value); onSearch?.(event.target.value); setActive(0); setOpen(true); if (value) onChange({ target: { value: '' } }) }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(null) }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); setActive(previous => Math.max(0, Math.min(filtered.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)))) }
    if (event.key === 'Enter' && open) { event.preventDefault(); if (filtered[active]) choose(filtered[active]) }
  }} />{value && !disabled && <button type="button" className="select-clear" aria-label="Limpiar selección" onMouseDown={event => event.preventDefault()} onClick={() => { onChange({ target: { value: '' } }); setQuery(''); setOpen(true); input.current?.focus() }}>×</button>}<span className="select-chevron" aria-hidden="true">⌄</span></div>{open && !disabled && <div className="select-results" style={above ? { top: 'auto', bottom: 'calc(100% + 5px)' } : undefined} id={listId} role="listbox" aria-label="Coincidencias">{loading ? <p role="status">Cargando opciones…</p> : !filtered.length ? <p role="status">Sin resultados</p> : filtered.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option" data-option-value={option.value} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={index === active ? 'highlighted' : ''} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</div>)}</div>}</div>
}

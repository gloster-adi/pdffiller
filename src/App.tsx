import { useEffect, useRef, useState } from 'react'
import {
  AlignLeft,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FilePlus2,
  FileText,
  Hand,
  LoaderCircle,
  MousePointer2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { openDB, type DBSchema } from 'idb'
import mammoth from 'mammoth'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

type TextStyle = 'typed' | 'handwritten'
type DocumentKind = 'pdf' | 'word'

interface PlacedField {
  id: string
  page: number
  text: string
  style: TextStyle
  color: string
  fontSize: number
  fontFamily?: string
  x: number
  y: number
}

interface PageInfo {
  width: number
  height: number
  text?: string
}

interface SavedTask {
  id: string
  name: string
  kind: DocumentKind
  fileName: string
  file: Blob
  fields: PlacedField[]
  savedAt: number
}

interface StudioDatabase extends DBSchema {
  tasks: {
    key: string
    value: SavedTask
  }
}

const database = openDB<StudioDatabase>('folio-fill', 1, {
  upgrade(db) {
    db.createObjectStore('tasks', { keyPath: 'id' })
  },
})

const COLORS = ['#203a78', '#171717', '#bd4d32', '#37765e']
const TYPED_FONTS = ['DM Sans', 'Georgia', 'Courier New', 'Merriweather']
const HANDWRITTEN_FONTS = ['Caveat', 'Patrick Hand', 'Kalam', 'Architects Daughter', 'Shadows Into Light', 'Pacifico', 'Dancing Script', 'Handlee', 'Permanent Marker', 'Indie Flower', 'Marcel', 'Bad Script', 'Just Another Hand', 'Kristen ITC']

function paginateWordText(text: string): string[] {
  const paragraphs = text.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const pages: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > 2050 && current) {
      pages.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current) pages.push(current)
  return pages.length ? pages : ['This document does not contain readable text.']
}

function splitLines(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<DocumentKind | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageInfo, setPageInfo] = useState<PageInfo[]>([])
  const [fields, setFields] = useState<PlacedField[]>([])
  const [text, setText] = useState('')
  const [style, setStyle] = useState<TextStyle>('typed')
  const [fontSize, setFontSize] = useState(18)
  const [fontFamily, setFontFamily] = useState(TYPED_FONTS[0])
  const [color, setColor] = useState(COLORS[0])
  const [activeField, setActiveField] = useState<string | null>(null)
  const [placementReady, setPlacementReady] = useState(false)
  const [savedTasks, setSavedTasks] = useState<SavedTask[]>([])
  const [showTasks, setShowTasks] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [taskName, setTaskName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [draggingField, setDraggingField] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({})

  useEffect(() => {
    void database.then((db) => db.getAll('tasks')).then(setSavedTasks)
  }, [])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    void Promise.all(pageInfo.map(async (_, index) => {
      const canvas = canvasRefs.current[index + 1]
      if (!canvas) return
      const page = await pdf.getPage(index + 1)
      const viewport = page.getViewport({ scale: 1.6 })
      const context = canvas.getContext('2d')
      if (!context || cancelled) return
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: context, viewport }).promise
    }))
    return () => { cancelled = true }
  }, [pdf, pageInfo])

  async function readDocument(nextFile: File, restoredFields: PlacedField[] = []) {
    setBusy(true)
    setError('')
    try {
      const extension = nextFile.name.split('.').pop()?.toLowerCase()
      const buffer = await nextFile.arrayBuffer()
      setFile(nextFile)
      setFields(restoredFields)
      setCurrentPage(1)
      if (extension === 'pdf') {
        const loaded = await getDocument({ data: buffer.slice(0) }).promise
        const dimensions = await Promise.all(Array.from({ length: loaded.numPages }, async (_, index) => {
          const page = await loaded.getPage(index + 1)
          const viewport = page.getViewport({ scale: 1 })
          return { width: viewport.width, height: viewport.height }
        }))
        setPdf(loaded)
        setPageInfo(dimensions)
        setKind('pdf')
      } else if (extension === 'docx') {
        const extracted = await mammoth.extractRawText({ arrayBuffer: buffer })
        const pages = paginateWordText(extracted.value)
        setPdf(null)
        setPageInfo(pages.map(() => ({ width: 612, height: 792 })))
        setWordPages(pages)
        setKind('word')
      } else {
        throw new Error('Choose a PDF or DOCX file to get started.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This document could not be opened.')
      setFile(null)
      setPdf(null)
      setPageInfo([])
      setKind(null)
    } finally {
      setBusy(false)
    }
  }

  const [wordPages, setWordPages] = useState<string[]>([])

  function handleUpload(nextFile?: File) {
    if (nextFile) void readDocument(nextFile)
  }

  function placeField(page: number, x: number, y: number) {
    if (!text.trim()) {
      setError('Add some details in the sidebar before placing them.')
      setPlacementReady(false)
      return
    }
    const field: PlacedField = {
      id: crypto.randomUUID(), page, text: text.trim(), style, color, fontSize, fontFamily,
      x: Math.max(0.015, Math.min(0.84, x)),
      y: Math.max(0.015, Math.min(0.94, y)),
    }
    setFields((current) => [...current, field])
    setActiveField(field.id)
    setPlacementReady(false)
    setError('')
  }

  function updateActiveField(patch: Partial<PlacedField>) {
    if (!activeField) return
    setFields((current) => current.map((field) => field.id === activeField ? { ...field, ...patch } : field))
  }

  function selectField(field: PlacedField) {
    setActiveField(field.id)
    setStyle(field.style)
    setFontSize(field.fontSize)
    setFontFamily(field.fontFamily ?? (field.style === 'handwritten' ? HANDWRITTEN_FONTS[0] : TYPED_FONTS[0]))
    setColor(field.color)
  }

  function changeStyle(nextStyle: TextStyle) {
    setStyle(nextStyle)
    const nextFont = nextStyle === 'handwritten' ? HANDWRITTEN_FONTS[0] : TYPED_FONTS[0]
    setFontFamily(nextFont)
    updateActiveField({ style: nextStyle, fontFamily: nextFont })
  }

  function changeFontSize(nextSize: number) {
    setFontSize(nextSize)
    updateActiveField({ fontSize: nextSize })
  }

  function changeFontFamily(nextFont: string) {
    setFontFamily(nextFont)
    updateActiveField({ fontFamily: nextFont })
  }

  function changeColor(nextColor: string) {
    setColor(nextColor)
    updateActiveField({ color: nextColor })
  }

  function updateFieldPosition(page: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingField) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0.015, Math.min(0.84, (event.clientX - bounds.left) / bounds.width))
    const y = Math.max(0.015, Math.min(0.94, (event.clientY - bounds.top) / bounds.height))
    setFields((current) => current.map((field) => field.id === draggingField ? { ...field, page, x, y } : field))
  }

  async function saveTask() {
    if (!file || !kind) return
    const name = taskName.trim()
    if (!name) return
    const task: SavedTask = {
      id: crypto.randomUUID(), name, kind, fileName: file.name, file,
      fields, savedAt: Date.now(),
    }
    const db = await database
    await db.put('tasks', task)
    setSavedTasks(await db.getAll('tasks'))
    setShowSaveDialog(false)
    setShowTasks(true)
  }

  function beginSaveTask() {
    if (!file) return
    setTaskName(file.name.replace(/\.[^.]+$/, ''))
    setShowSaveDialog(true)
  }

  async function openTask(task: SavedTask) {
    setShowTasks(false)
    await readDocument(new File([task.file], task.fileName, { type: task.file.type }), task.fields)
  }

  async function deleteTask(id: string) {
    const db = await database
    await db.delete('tasks', id)
    setSavedTasks(await db.getAll('tasks'))
  }

  async function exportPdf() {
    if (!file || !kind) return
    setBusy(true)
    setError('')
    try {
      const output = kind === 'pdf' && pdf
        ? await PDFDocument.load(await file.arrayBuffer())
        : await PDFDocument.create()
      const wordFont = await output.embedFont(StandardFonts.TimesRoman)

      if (kind === 'word') {
        for (const [index, pageText] of wordPages.entries()) {
          const page = output.addPage([612, 792])
          const lines = pageText.split('\n').flatMap((paragraph) => splitLines(paragraph, wordFont, 11, 492))
          let y = 744
          for (const line of lines) {
            if (y < 48) break
            page.drawText(line, { x: 60, y, size: 11, font: wordFont, color: rgb(0.12, 0.12, 0.12) })
            y -= 16
          }
          if (index === 0 && !pageText.trim()) page.drawText(' ', { x: 60, y: 744, size: 11, font: wordFont })
        }
      }

      for (const field of fields) {
        const page = output.getPage(field.page - 1)
        if (!page) continue
        const { width, height } = page.getSize()
        const x = field.x * width
        const top = field.y * height
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) continue
        const scale = 3
        const family = field.fontFamily ?? (field.style === 'handwritten' ? HANDWRITTEN_FONTS[0] : TYPED_FONTS[0])
        const fallback = field.style === 'handwritten' ? 'cursive' : 'sans-serif'
        await document.fonts.load(`${field.fontSize * scale}px "${family}"`)
        context.font = `${field.fontSize * scale}px "${family}", ${fallback}`
        const metrics = context.measureText(field.text)
        canvas.width = Math.ceil(metrics.width + 12 * scale)
        canvas.height = Math.ceil(field.fontSize * scale * 1.65)
        context.font = `${field.fontSize * scale}px "${family}", ${fallback}`
        context.fillStyle = field.color
        context.textBaseline = 'middle'
        context.fillText(field.text, 4 * scale, canvas.height / 2)
        const image = await output.embedPng(canvas.toDataURL('image/png'))
        const scaleToPage = width / 612
        const imageWidth = (canvas.width / scale) * scaleToPage
        const imageHeight = (canvas.height / scale) * scaleToPage
        page.drawImage(image, { x, y: height - top - imageHeight, width: imageWidth, height: imageHeight })
      }

      const bytes = await output.save()
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${file.name.replace(/\.[^.]+$/, '')}-filled.pdf`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF export failed. Try reopening the document.')
    } finally {
      setBusy(false)
    }
  }

  function onPageDrop(page: number, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    placeField(page, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
  }

  function scrollToPage(nextPage: number) {
    const bounded = Math.max(1, Math.min(pageInfo.length, nextPage))
    pageRefs.current[bounded]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrentPage(bounded)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Folio Fill - Gloster Document Studio home">
          <span className="brand-mark"><FileText size={18} strokeWidth={1.8} /></span>
          <span>folio<span className="brand-accent">fill</span></span>
        </a>
        <div className="topbar-center">
          <span className="studio-label">GLOSTER DOCUMENT STUDIO</span>
          {file && <><span className="crumb-divider">/</span><span className="current-file" title={file.name}>{file.name}</span></>}
        </div>
        <div className="topbar-actions">
          <div className="task-menu-wrap">
            <button className="button button-quiet" onClick={() => setShowTasks((show) => !show)} aria-expanded={showTasks}>
              <Save size={16} /> <span>My tasks</span> <ChevronDown size={14} />
            </button>
            {showTasks && (
              <div className="task-menu">
                <div className="task-menu-heading"><span>Saved tasks</span><button className="icon-button" onClick={() => setShowTasks(false)} aria-label="Close saved tasks"><X size={16} /></button></div>
                {savedTasks.length === 0 ? <p className="task-empty">Your saved work will show up here.</p> : savedTasks.map((task) => (
                  <div className="task-row" key={task.id}>
                    <button className="task-open" onClick={() => void openTask(task)}><FileText size={16} /><span><strong>{task.name}</strong><small>{task.fileName}</small></span></button>
                    <button className="icon-button" onClick={() => void deleteTask(task.id)} aria-label={`Delete ${task.name}`}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="button button-primary" onClick={() => void exportPdf()} disabled={!file || busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}
            <span>Export PDF</span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div><span className="eyebrow">YOUR WORKSPACE</span><h1>Make it yours.</h1></div>
            {file && <button className="icon-button new-doc" onClick={() => inputRef.current?.click()} title="Open another document" aria-label="Open another document"><FilePlus2 size={18} /></button>}
          </div>

          {!file ? (
            <div className="sidebar-empty">
              <div className="empty-illustration"><FileText size={24} /><span>+</span></div>
              <h2>Start with a document</h2>
              <p>Bring in a form, then add your details wherever they belong.</p>
              <button className="button button-primary upload-button" onClick={() => inputRef.current?.click()}><Upload size={16} />Open a document</button>
              <span className="file-note">PDF or Word document (.docx)</span>
            </div>
          ) : (
            <>
              <div className="document-card">
                <div className="document-icon"><FileText size={20} /></div>
                <div className="document-copy"><strong>{file.name}</strong><span>{busy && !kind ? 'Preparing document…' : `${kind === 'pdf' ? 'PDF document' : 'Word document'} · ${pageInfo.length} ${pageInfo.length === 1 ? 'page' : 'pages'}`}</span></div>
                <button className="icon-button" onClick={() => { setFile(null); setKind(null); setPdf(null); setPageInfo([]); setFields([]) }} aria-label="Close document"><X size={16} /></button>
              </div>

              <div className="section-label"><span>01</span><h2>Your details</h2></div>
              <label className="field-label" htmlFor="field-text">Text to place</label>
              <textarea id="field-text" className="details-input" placeholder="Type a name, date, or anything else…" value={text} onChange={(event) => setText(event.target.value)} rows={3} />

              <div className="control-row">
                <span className="field-label">Writing style</span>
                <div className="segmented-control" role="group" aria-label="Writing style">
                    <button className={style === 'typed' ? 'selected' : ''} onClick={() => changeStyle('typed')} aria-pressed={style === 'typed'}><AlignLeft size={15} />Typed</button>
                    <button className={style === 'handwritten' ? 'selected' : ''} onClick={() => changeStyle('handwritten')} aria-pressed={style === 'handwritten'}><Hand size={15} />Hand</button>
                </div>
              </div>

              <div className="control-row font-row">
                <label className="field-label" htmlFor="font-family">{activeField ? 'Font for selected text' : style === 'handwritten' ? 'Handwriting font' : 'Typed font'}</label>
                <select id="font-family" className={`font-select ${style === 'handwritten' ? 'font-select-hand' : ''}`} value={fontFamily} onChange={(event) => changeFontFamily(event.target.value)}>
                  {(style === 'handwritten' ? HANDWRITTEN_FONTS : TYPED_FONTS).map((family) => <option key={family} value={family}>{family}</option>)}
                </select>
              </div>

              <div className="control-row color-row">
                <span className="field-label">Ink color</span>
                <div className="swatches" role="group" aria-label="Ink color">
                  {COLORS.map((swatch) => <button key={swatch} className={`swatch ${color === swatch ? 'chosen' : ''}`} style={{ backgroundColor: swatch }} onClick={() => changeColor(swatch)} aria-label={`Choose ${swatch} ink`} aria-pressed={color === swatch}>{color === swatch && <Check size={13} />}</button>)}
                  <label className="custom-color" title="Choose a custom ink color"><input type="color" value={color} onChange={(event) => changeColor(event.target.value)} aria-label="Choose custom ink color" /><span>+</span></label>
                </div>
              </div>

              <div className="control-row size-row">
                <label className="field-label" htmlFor="font-size">{activeField ? 'Selected text size' : 'Text size'}</label>
                <div className="size-control"><input id="font-size" type="range" min="8" max="48" value={fontSize} onChange={(event) => changeFontSize(Number(event.target.value))} /><output htmlFor="font-size">{fontSize}px</output></div>
              </div>

              <div className="placement-area">
                <div className="section-label"><span>02</span><h2>Place on page</h2></div>
                <p>Drag your text onto the document, or tap the page to place it.</p>
                <button className={`placement-chip ${!text.trim() ? 'is-disabled' : ''}`} draggable={Boolean(text.trim())} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', 'folio-field') }} onClick={() => { if (!text.trim()) setError('Add some details before placing them.'); else setPlacementReady(true) }}>
                  <MousePointer2 size={15} /><span style={{ fontFamily: `"${fontFamily}", ${style === 'handwritten' ? 'cursive' : 'sans-serif'}`, fontSize: `${Math.min(fontSize, 18)}px` }}>{text.trim() || 'Your text goes here'}</span><Plus size={15} />
                </button>
                {placementReady && <div className="placement-hint"><span className="hint-dot" />Now tap anywhere on the page to place it.<button className="icon-button" onClick={() => setPlacementReady(false)} aria-label="Cancel placement"><X size={14} /></button></div>}
              </div>

              <div className="placed-list">
                <div className="section-label"><span>03</span><h2>Placed text</h2><span className="count-badge">{fields.length}</span></div>
                {fields.length === 0 ? <p className="no-fields">Nothing placed yet. Your fields will collect here.</p> : fields.map((field) => (
                  <div className={`placed-row ${activeField === field.id ? 'is-active' : ''}`} key={field.id} onClick={() => { selectField(field); scrollToPage(field.page) }}>
                    <span className="field-color-dot" style={{ backgroundColor: field.color }} />
                    <span className={field.style === 'handwritten' ? 'handwritten-preview' : ''}>{field.text}</span>
                    <small>p. {field.page}</small>
                    <button className="icon-button" onClick={(event) => { event.stopPropagation(); setFields((current) => current.filter((item) => item.id !== field.id)); if (activeField === field.id) setActiveField(null) }} aria-label={`Remove ${field.text}`}><X size={14} /></button>
                  </div>
                ))}
              </div>

              <div className="sidebar-footer">
                <span className="autosave-indicator"><span />Saved in this browser</span>
                <button className="button button-outline" onClick={beginSaveTask}><Save size={15} />Save task</button>
              </div>
            </>
          )}
        </aside>

        <section className="document-stage" aria-label="Document pages">
          <div className="stage-toolbar">
            <div className="stage-status">{file ? <><span className="status-dot" /><span>{fields.length ? `${fields.length} field${fields.length === 1 ? '' : 's'} placed` : 'Ready to fill'}</span></> : <><span className="status-dot status-idle" /><span>Waiting for a document</span></>}</div>
            {pageInfo.length > 0 && <div className="page-control"><button className="icon-button" onClick={() => scrollToPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page"><ArrowLeft size={16} /></button><span><strong>{currentPage}</strong><i>/</i>{pageInfo.length}</span><button className="icon-button" onClick={() => scrollToPage(currentPage + 1)} disabled={currentPage >= pageInfo.length} aria-label="Next page"><ArrowRight size={16} /></button></div>}
            {file && <button className="stage-save" onClick={beginSaveTask}><Save size={15} /><span>Save</span></button>}
          </div>

          <div className={`page-scroller ${!file ? 'has-empty' : ''}`} onScroll={(event) => {
            if (!pageInfo.length) return
            const bounds = event.currentTarget.getBoundingClientRect()
            const middle = bounds.top + bounds.height * 0.34
            let nearest = 1
            let distance = Number.POSITIVE_INFINITY
            pageInfo.forEach((_, index) => {
              const pageBounds = pageRefs.current[index + 1]?.getBoundingClientRect()
              if (!pageBounds) return
              const nextDistance = Math.abs(pageBounds.top - middle)
              if (nextDistance < distance) { distance = nextDistance; nearest = index + 1 }
            })
            setCurrentPage(nearest)
          }}>
            {!file ? (
              <div className="welcome-state" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleUpload(event.dataTransfer.files[0]) }}>
                <div className="welcome-kicker"><span />A calmer way to complete paperwork</div>
                <h2>Paperwork,<br /><em>made personal.</em></h2>
                <p>Drop in a form. Place each detail exactly where it belongs. Leave with a finished PDF.</p>
                <button className="button button-primary welcome-upload" onClick={() => inputRef.current?.click()}><Upload size={17} />Choose a document<ArrowRight size={16} /></button>
                <div className="supported-types"><span>PDF</span><span>DOCX</span><i>Drop a file anywhere to begin</i></div>
                <div className="paper-preview" aria-hidden="true"><div className="paper-topline" /><div className="paper-title-lines"><span /><span /></div><div className="paper-rule" /><div className="paper-row"><span /><b /></div><div className="paper-row"><span /><b /></div><div className="paper-row"><span /><b /></div><div className="paper-scribble">Your signature</div><div className="paper-footline" /></div>
                <div className="stage-caption"><span>01 /</span> Make space for the important details</div>
              </div>
            ) : (
              <div className="pages-column">
                {pageInfo.map((page, index) => {
                  const pageNumber = index + 1
                  return <div className="page-frame" key={`${file.name}-${pageNumber}`}>
                    <div className="page-caption"><span>PAGE {String(pageNumber).padStart(2, '0')}</span><span>{kind === 'pdf' ? 'ORIGINAL DOCUMENT' : 'WORD PREVIEW'}</span></div>
                    <div
                      ref={(element) => { pageRefs.current[pageNumber] = element }}
                      className={`paper-page ${placementReady ? 'placement-mode' : ''}`}
                      style={{ aspectRatio: `${page.width} / ${page.height}` }}
                      onClick={(event) => {
                        if (placementReady) {
                          const bounds = event.currentTarget.getBoundingClientRect()
                          placeField(pageNumber, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
                        } else {
                          setActiveField(null)
                        }
                      }}
                      onPointerMove={(event) => updateFieldPosition(pageNumber, event)}
                      onPointerUp={() => setDraggingField(null)}
                      onPointerLeave={() => setDraggingField(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onPageDrop(pageNumber, event)}
                    >
                      {kind === 'pdf' ? <canvas className="pdf-canvas" ref={(element) => { canvasRefs.current[pageNumber] = element }} /> : <div className="word-page-text">{wordPages[index]}</div>}
                      {fields.filter((field) => field.page === pageNumber).map((field) => <div
                        key={field.id}
                        className={`placed-on-page ${field.style === 'handwritten' ? 'handwriting' : ''} ${activeField === field.id ? 'selected' : ''}`}
                        style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, color: field.color, fontSize: `${field.fontSize}px`, fontFamily: field.fontFamily ?? (field.style === 'handwritten' ? HANDWRITTEN_FONTS[0] : TYPED_FONTS[0]) }}
                        onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingField(field.id); selectField(field) }}
                        onClick={(event) => { event.stopPropagation(); selectField(field) }}
                      >{field.text}<button className="remove-on-page" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setFields((current) => current.filter((item) => item.id !== field.id)); if (activeField === field.id) setActiveField(null) }} aria-label={`Remove ${field.text}`}><X size={12} /></button></div>)}
                    </div>
                    {kind === 'word' && <span className="word-conversion-note">Word preview is text-based; original layout and formatting may differ.</span>}
                  </div>
                })}
              </div>
            )}
          </div>
          {error && <div className="error-toast" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
          {busy && <div className="busy-cover"><LoaderCircle className="spin" size={22} /><span>Preparing your document…</span></div>}
        </section>
      </section>

      <input ref={inputRef} className="visually-hidden" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { handleUpload(event.target.files?.[0]); event.currentTarget.value = '' }} />
      {showSaveDialog && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSaveDialog(false) }}>
        <form className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title" onSubmit={(event) => { event.preventDefault(); void saveTask() }}>
          <div className="save-dialog-icon"><Save size={18} /></div>
          <h2 id="save-dialog-title">Save this task</h2>
          <p>Your document and placed text will be saved in this browser.</p>
          <label className="field-label" htmlFor="task-name">Task name</label>
          <input id="task-name" className="task-name-input" autoFocus value={taskName} onChange={(event) => setTaskName(event.target.value)} maxLength={80} required />
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setShowSaveDialog(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={!taskName.trim()}><Save size={15} />Save task</button></div>
        </form>
      </div>}
      <button className="reset-button" onClick={() => { setFile(null); setKind(null); setPdf(null); setPageInfo([]); setFields([]); setError('') }} title="Clear current document" aria-label="Clear current document"><RotateCcw size={15} /></button>
    </main>
  )
}

export default App
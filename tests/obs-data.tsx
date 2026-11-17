import { createRoot } from 'react-dom/client'
import { DataProvider, useData } from '../src/lib/data'
let renders = 0
function Probe() { const { reload } = useData(); renders++; return <><output>{renders}</output><button onClick={() => void reload()}>Reload</button></> }
createRoot(document.getElementById('root')!).render(<DataProvider><Probe /></DataProvider>)

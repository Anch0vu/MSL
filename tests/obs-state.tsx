import { createRoot } from 'react-dom/client'
import { useObs } from '../src/lib/obsState'
function Probe() { const { state, loaded, reload, patch } = useObs(); return <><output>{loaded ? state.series?.a : 'loading'}</output><button id="reload" onClick={() => void reload()}>Reload</button><button id="patch" onClick={() => void patch({ series: { a: 1, b: 0 } })}>Patch</button></> }
createRoot(document.getElementById('root')!).render(<Probe />)

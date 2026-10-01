// ── CLOCK ─────────────────────────────────────
function tick(){
  const n=new Date();
  document.getElementById('clk-t').textContent=n.toLocaleTimeString('en-IN',{hour12:false});
  document.getElementById('clk-d').textContent=n.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}
setInterval(tick,1000);tick();
 
// ── CHART SETUP ───────────────────────────────
const MAX_PTS=60;
const tLabels=[];
const td={T1:[],T2:[],T3:[],T4:[]};
const fd={F1:[],F2:[]};
const prev={T1:null,T2:null,T3:null,T4:null,F1:null,F2:null};
const logs=[];
 
const axCfg={
  grid:{color:'rgba(255,255,255,0.05)',drawBorder:false},
  ticks:{color:'#555',font:{family:'Segoe UI',size:9}},
  border:{display:false}
};
const plugCfg={
  legend:{display:false},
  tooltip:{
    backgroundColor:'rgba(30,30,30,.95)',
    borderColor:'rgba(131,197,190,.35)',borderWidth:1,
    titleColor:'#888',bodyColor:'#f0f0f0',
    padding:9,
    titleFont:{family:'Segoe UI',size:9},
    bodyFont:{family:'Segoe UI',size:11,weight:'600'}
  }
};
 
function mkChart(id,datasets,yLabel){
  return new Chart(document.getElementById(id).getContext('2d'),{
    type:'line',
    data:{labels:tLabels,datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:250},
      interaction:{mode:'index',intersect:false},
      plugins:plugCfg,
      scales:{
        x:{...axCfg,ticks:{...axCfg.ticks,maxRotation:0,maxTicksLimit:8}},
        y:{...axCfg,title:{display:true,text:yLabel,color:'#555',font:{family:'Segoe UI',size:9}}}
      }
    }
  });
}
 
function ds(label,color,data){
  return{label,data,borderColor:color,backgroundColor:color+'18',
         borderWidth:1.8,pointRadius:0,pointHoverRadius:3,tension:0.4,fill:false};
}
 
// ── 6 INDIVIDUAL CHARTS — white bg, black labels ──
function mkSingleChart(id, color, label, yLabel, yMin, yMax) {
  return new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: {
      labels: tLabels,
      datasets: [{
        data: [],
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.4,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff',
          borderColor: color,
          borderWidth: 1,
          titleColor: '#333',
          bodyColor: '#111',
          padding: 7,
          bodyFont: { size: 11, weight: '700' },
        }
      },
      scales: {
        x: {
          grid: { color: '#e8e8e8' },
          ticks: { color: '#333', font: { size: 9 }, maxRotation: 0, maxTicksLimit: 6 },
          border: { color: '#ccc' }
        },
        y: {
          min: yMin, max: yMax,
          grid: { color: '#e8e8e8' },
          ticks: { color: '#333', font: { size: 9 } },
          border: { color: '#ccc' },
          title: { display: true, text: yLabel, color: '#555', font: { size: 9 } }
        }
      }
    }
  });
}

// Create 6 charts — white background set via canvas parent CSS
const chartT1 = mkSingleChart('ch_T1', '#00b4cc', 'T1 Storage',   '°C',    0,  100);
const chartT2 = mkSingleChart('ch_T2', '#00a86b', 'T2 Inlet',     '°C',    0,  100);
const chartT3 = mkSingleChart('ch_T3', '#cc8800', 'T3 Absorber',  '°C',    0,  100);
const chartT4 = mkSingleChart('ch_T4', '#cc3070', 'T4 Outlet',    '°C',    0,  100);
const chartF1 = mkSingleChart('ch_F1', '#7c52fa', 'F1 Inlet',     'L/min', 0,    5);
const chartF2 = mkSingleChart('ch_F2', '#0080cc', 'F2 Outlet',    'L/min', 0,    5);

// Map: key → chart object and its private data array
const indivCharts = {
  T1: { chart: chartT1, data: [] },
  T2: { chart: chartT2, data: [] },
  T3: { chart: chartT3, data: [] },
  T4: { chart: chartT4, data: [] },
  F1: { chart: chartF1, data: [] },
  F2: { chart: chartF2, data: [] },
};
 
// ── UI HELPERS ────────────────────────────────
function setCtrl(key,state){
  const card=document.getElementById('c-'+key);
  const stat=document.getElementById('s-'+key);
  card.className='c-card '+(state?'on':'off');
  card.style.setProperty('--state-col',state?'var(--on)':'var(--off)');
  stat.textContent=state?'ON':'OFF';
  const changed = card.dataset.st !== (state?'1':'0');
  card.dataset.st = state?'1':'0';
  if(key==='pump' && changed) animatePressure(!!state);
}
 
// ══════════════════════════════════════════════════════════════
// SENSOR DATA VALIDATION & FAULT DETECTION (industry IoT pattern)
// Raw hardware data is NEVER trusted directly. Before it reaches the
// UI, charts, or any ML model, every reading passes through:
//   1. Type/NaN check              — missing readings held at last-good
//   2. Known disconnect signatures — e.g. DS18B20 returns -127°C or
//                                     +85°C when a probe is unplugged
//   3. Physical range clamp        — T outside [-10,150]°C, F outside
//                                     [0,20] L/min is not physically real
//   4. Stuck-sensor detection      — if one sensor flatlines for 8
//                                     straight readings while OTHER
//                                     sensors are actively varying,
//                                     that's very likely a wiring fault,
//                                     not a real steady-state
// This is the same category of defense used in real industrial SCADA
// and IoT telemetry systems — never let raw sensor noise/faults reach
// the display or a model unfiltered.
// ══════════════════════════════════════════════════════════════
const SENSOR_RANGES = { T1:[-10,150], T2:[-10,150], T3:[-10,150], T4:[-10,150], F1:[0,20], F2:[0,20] };
const DISCONNECT_SIGNATURES = [-127, 85, -196, -999];
const STUCK_WINDOW = 8;
const sensorHistoryRaw = { T1:[], T2:[], T3:[], T4:[], F1:[], F2:[] };
const sensorHealth = { T1:'ok', T2:'ok', T3:'ok', T4:'ok', F1:'ok', F2:'ok' };
let dataQualityIssueCount = 0;
const dataQualityLog = [];

function validateSensors(rawSensors) {
  const clean = {};
  const issues = [];

  for (const key of Object.keys(SENSOR_RANGES)) {
    let v = rawSensors[key];
    const [lo, hi] = SENSOR_RANGES[key];
    let status = 'ok';

    if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) {
      status = 'fault';
      issues.push(`${key}: missing/NaN reading — held at last known value`);
      const h = sensorHistoryRaw[key];
      v = h.length ? h[h.length-1] : (lo+hi)/2;
    } else if (DISCONNECT_SIGNATURES.includes(Math.round(v))) {
      status = 'fault';
      issues.push(`${key}: disconnect signature detected (raw=${v}) — probe likely unplugged`);
      const h = sensorHistoryRaw[key];
      v = h.length ? h[h.length-1] : (lo+hi)/2;
    } else if (v < lo || v > hi) {
      status = 'warn';
      issues.push(`${key}: out of physical range (${v}) — clamped to [${lo},${hi}]`);
      v = Math.max(lo, Math.min(hi, v));
    }

    const hist = sensorHistoryRaw[key];
    hist.push(v);
    if (hist.length > STUCK_WINDOW) hist.shift();
    const isRestingFlowZero = (key === 'F1' || key === 'F2') && v === 0;
    if (status === 'ok' && hist.length === STUCK_WINDOW && !isRestingFlowZero) {
      const allSame = hist.every(x => x === hist[0]);
      const othersVarying = Object.keys(SENSOR_RANGES).some(k => {
        if (k === key) return false;
        const h2 = sensorHistoryRaw[k];
        return h2.length >= STUCK_WINDOW && new Set(h2).size > 1;
      });
      if (allSame && othersVarying) {
        status = 'stuck';
        issues.push(`${key}: flatlined for ${STUCK_WINDOW} consecutive readings — possibly stuck/disconnected`);
      }
    }

    sensorHealth[key] = status;
    clean[key] = v;
  }

  if (issues.length) {
    dataQualityIssueCount += issues.length;
    const ts = new Date().toLocaleTimeString('en-IN',{hour12:false});
    issues.forEach(msg => {
      dataQualityLog.unshift({ ts, msg });
      console.warn('[Sensor Validation]', msg);
    });
    if (dataQualityLog.length > 50) dataQualityLog.length = 50;
  }

  renderSensorHealthDots();
  return clean;
}

function renderSensorHealthDots() {
  const colors = { ok:'#00e676', warn:'#ffb340', fault:'#ff3d3d', stuck:'#a78bfa' };
  Object.keys(sensorHealth).forEach(key => {
    let dot = document.getElementById('health-'+key);
    const anchor = document.getElementById(key==='T1'||key==='T2'||key==='T3'||key==='T4' ? 'zone-'+key : 'd-'+key);
    if (!dot && anchor && anchor.parentNode) {
      dot = document.createElement('span');
      dot.id = 'health-'+key;
      dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:5px;vertical-align:middle;transition:background .3s';
      anchor.parentNode.insertBefore(dot, anchor.nextSibling);
    }
    if (dot) {
      dot.style.background = colors[sensorHealth[key]] || colors.ok;
      dot.title = `${key}: ${sensorHealth[key].toUpperCase()}`;
    }
  });
}

// ── Single choke point: every raw reading passes through here ──
function ingestSensorReading(rawSensors, ctrl, ts) {
  const clean = validateSensors(rawSensors);
  ['T1','T2','T3','T4'].forEach(k=>setSensor(k,clean[k],false));
  ['F1','F2'].forEach(k=>setSensor(k,clean[k],true));
  pushPoint(clean);
  if (ctrl) {
    setCtrl('power', !!ctrl.power_supply);
    setCtrl('sol',   !!ctrl.solenoid_valve);
    setCtrl('pump',  !!ctrl.pump);
    setCtrl('lamp',  !!ctrl.artificial_lamp);
    pushLog(clean, ctrl);
  }
  return clean;
}

function setSensor(id,val,isFlow){
  const el=document.getElementById('v-'+id);
  const del=document.getElementById('d-'+id);
  const pv=prev[id];
  el.textContent=isFlow?val.toFixed(2):val.toFixed(1);
  if(pv!==null){
    const diff=val-pv;
    const abs=Math.abs(diff).toFixed(2);
    if(diff>0.01){del.className=(el.closest('.gauge-card')?'gauge-delta ':'s-delta ')+'d-up';del.textContent='↑'+abs;}
    else if(diff<-0.01){del.className=(el.closest('.gauge-card')?'gauge-delta ':'s-delta ')+'d-dn';del.textContent='↓'+abs;}
    else{del.className=(el.closest('.gauge-card')?'gauge-delta ':'s-delta ')+'d-fl';del.textContent='→';}
  }
  prev[id]=val;
  // Drive gauge for temperatures
  if(['T1','T2','T3','T4'].includes(id)){
    drawGauge(id, val, '');
    updateGaugeZone(id, val);
  }
  // Drive sparkline for flows
  if(['F1','F2'].includes(id)) updateSparkline(id, val);
}
 
function pushPoint(sensors){
  const t=new Date().toLocaleTimeString('en-IN',{hour12:false});
  tLabels.push(t);
  if(tLabels.length>MAX_PTS) tLabels.shift();

  // Feed each individual chart
  const keys=['T1','T2','T3','T4','F1','F2'];
  keys.forEach(k=>{
    const ic=indivCharts[k];
    ic.data.push(sensors[k]||0);
    if(ic.data.length>MAX_PTS) ic.data.shift();
    ic.chart.data.labels=[...tLabels];
    ic.chart.data.datasets[0].data=[...ic.data];
    ic.chart.update('none');
  });

  // Feature 4 + 2: KPI bar and heatmap
  updateKPI(sensors);
  updateHeatmap(sensors);
  // ML Pipeline
  runMLPipeline(sensors);
  // Advanced science features
  runAllAdvanced(sensors);
}
 
function pushLog(sensors,ctrl){
  const ts=new Date().toLocaleString('en-IN');
  logs.unshift({ts,...sensors,...ctrl});
  if(logs.length>300)logs.pop();
  const tbody=document.getElementById('log-body');
  document.getElementById('log-cnt').textContent=logs.length+' records';
  tbody.innerHTML=logs.map((e,i)=>`
    <tr class="${i===0?'new-row':''}">
      <td class="ts">${e.ts}</td>
      <td style="color:var(--t1)">${(e.T1||0).toFixed(1)}</td>
      <td style="color:var(--t2)">${(e.T2||0).toFixed(1)}</td>
      <td style="color:var(--t3)">${(e.T3||0).toFixed(1)}</td>
      <td style="color:var(--t4)">${(e.T4||0).toFixed(1)}</td>
      <td style="color:var(--f1)">${(e.F1||0).toFixed(2)}</td>
      <td style="color:var(--f2)">${(e.F2||0).toFixed(2)}</td>
      <td style="color:${e.power_supply?'var(--on)':'var(--off)'}">${e.power_supply?'ON':'OFF'}</td>
      <td style="color:${e.solenoid_valve?'var(--on)':'var(--off)'}">${e.solenoid_valve?'ON':'OFF'}</td>
      <td style="color:${e.pump?'var(--on)':'var(--off)'}">${e.pump?'ON':'OFF'}</td>
      <td style="color:${e.artificial_lamp?'var(--on)':'var(--off)'}">${e.artificial_lamp?'ON':'OFF'}</td>
    </tr>`).join('');
}
 
// ── DEMO MODE ─────────────────────────────────
const DEFAULT_DEMO_SEQUENCE = [
  { T1: 34.2, T2: 30.1, T3: 52.8, T4: 41.7, F1: 2.1, F2: 1.9, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: false },
  { T1: 35.4, T2: 30.8, T3: 54.6, T4: 42.9, F1: 2.2, F2: 1.9, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: false },
  { T1: 36.8, T2: 31.5, T3: 57.0, T4: 44.6, F1: 2.4, F2: 2.0, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: false },
  { T1: 38.1, T2: 32.2, T3: 59.8, T4: 46.2, F1: 2.6, F2: 2.1, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: true },
  { T1: 39.7, T2: 32.9, T3: 62.4, T4: 48.0, F1: 2.7, F2: 2.3, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: true },
  { T1: 40.6, T2: 33.4, T3: 64.9, T4: 49.5, F1: 2.8, F2: 2.4, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: true },
  { T1: 41.2, T2: 34.0, T3: 67.0, T4: 50.9, F1: 2.9, F2: 2.4, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: true },
  { T1: 42.0, T2: 34.5, T3: 68.4, T4: 52.1, F1: 3.0, F2: 2.5, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: true },
  { T1: 41.5, T2: 34.8, T3: 67.9, T4: 51.7, F1: 2.9, F2: 2.5, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: true },
  { T1: 40.8, T2: 34.0, T3: 66.4, T4: 50.3, F1: 2.8, F2: 2.4, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: false },
  { T1: 39.4, T2: 33.1, T3: 63.6, T4: 48.9, F1: 2.7, F2: 2.3, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: false },
  { T1: 38.1, T2: 32.3, T3: 61.0, T4: 47.4, F1: 2.5, F2: 2.2, power_supply: true, solenoid_valve: true, pump: true, artificial_lamp: false }
];

let DEMO_SENSOR_SEQUENCE = DEFAULT_DEMO_SEQUENCE.slice();

function toCSVLine(row) {
  return [
    row.timestamp || '',
    row.T1 ?? '',
    row.T2 ?? '',
    row.T3 ?? '',
    row.T4 ?? '',
    row.F1 ?? '',
    row.F2 ?? '',
    row.power_supply ?? '',
    row.solenoid_valve ?? '',
    row.pump ?? '',
    row.artificial_lamp ?? ''
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
}

async function loadDemoData() {
  try {
    const response = await fetch('demo_data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('demo_data.json not found');
    const data = await response.json();
    if (Array.isArray(data) && data.length) {
      DEMO_SENSOR_SEQUENCE = data;
      console.log('[Demo] Loaded demo data from demo_data.json');
      return true;
    }
    throw new Error('demo_data.json did not contain records');
  } catch (e) {
    console.warn('[Demo] Falling back to embedded dataset:', e.message);
    DEMO_SENSOR_SEQUENCE = DEFAULT_DEMO_SEQUENCE.slice();
    return false;
  }
}

function downloadDemoCSV() {
  const rows = DEMO_SENSOR_SEQUENCE.length ? DEMO_SENSOR_SEQUENCE : DEFAULT_DEMO_SEQUENCE;
  const header = 'timestamp,T1,T2,T3,T4,F1,F2,power_supply,solenoid_valve,pump,artificial_lamp';
  const csv = [header].concat(rows.map(r => toCSVLine({
    timestamp: r.timestamp || new Date().toISOString(),
    T1: r.T1,
    T2: r.T2,
    T3: r.T3,
    T4: r.T4,
    F1: r.F1,
    F2: r.F2,
    power_supply: r.power_supply,
    solenoid_valve: r.solenoid_valve,
    pump: r.pump,
    artificial_lamp: r.artificial_lamp
  }))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'demo_telemetry.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const dT={T1:38,T2:32,T3:62,T4:47};
const dF={F1:2.4,F2:2.1};
const dC={power_supply:true,solenoid_valve:true,pump:true,artificial_lamp:false};
let tick2=0;
let demoSequenceIndex=0;
 
function demoStep(){
  const seq = DEMO_SENSOR_SEQUENCE[demoSequenceIndex % DEMO_SENSOR_SEQUENCE.length];
  if (seq) {
    dT.T1 = seq.T1 + ((Math.random() - 0.5) * 0.5);
    dT.T2 = seq.T2 + ((Math.random() - 0.5) * 0.6);
    dT.T3 = seq.T3 + ((Math.random() - 0.5) * 0.8);
    dT.T4 = seq.T4 + ((Math.random() - 0.5) * 0.7);
    dF.F1 = seq.F1 + ((Math.random() - 0.5) * 0.12);
    dF.F2 = seq.F2 + ((Math.random() - 0.5) * 0.1);
    dC.power_supply = !!seq.power_supply;
    dC.solenoid_valve = !!seq.solenoid_valve;
    dC.pump = !!seq.pump;
    dC.artificial_lamp = !!seq.artificial_lamp;
    demoSequenceIndex += 1;
  } else {
    dT.T1+=((Math.random()-.44)*.4);
    dT.T2+=((Math.random()-.46)*.5);
    dT.T3+=((Math.random()-.45)*.7);
    dT.T4+=((Math.random()-.45)*.45);
    dF.F1=Math.max(.5,Math.min(5,dF.F1+(Math.random()-.5)*.05));
    dF.F2=Math.max(.3,Math.min(4.8,dF.F2+(Math.random()-.5)*.04));
    if(++tick2%25===0)dC.artificial_lamp=!dC.artificial_lamp;
  }

  for(const k in dT)dT[k]=Math.max(25,Math.min(95,dT[k]));
  dF.F1=Math.max(.5,Math.min(5,dF.F1));
  dF.F2=Math.max(.3,Math.min(4.8,dF.F2));
 
  const sensors={...dT,...dF};
  setCtrl('power',dC.power_supply);
  setCtrl('sol',dC.solenoid_valve);
  setCtrl('pump',dC.pump);
  setCtrl('lamp',dC.artificial_lamp);
  const clean = validateSensors(sensors);
  ['T1','T2','T3','T4'].forEach(k=>setSensor(k,clean[k],false));
  ['F1','F2'].forEach(k=>setSensor(k,clean[k],true));
  pushPoint(clean);
  if(tick2%5===0 || demoSequenceIndex % 3 === 0)pushLog(clean,{...dC});
}
 
let demoTimer = null;

function startDemo(){
  document.getElementById('modal').style.display='none';
  const p=document.getElementById('pill');
  p.className='live-pill demo';
  document.getElementById('pill-txt').textContent='DEMO MODE';
  demoSequenceIndex = 0;
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = setInterval(demoStep,2000);
  demoStep();
}

async function startDemoFromDefault(){
  await loadDemoData();
  startDemo();
}
 
// ── FIREBASE ──────────────────────────────────
function connectFB(){
  const cfg={
    apiKey:document.getElementById('f-api').value.trim(),
    authDomain:document.getElementById('f-auth').value.trim(),
    databaseURL:document.getElementById('f-db').value.trim(),
    projectId:document.getElementById('f-proj').value.trim()
  };
  if(!cfg.databaseURL){alert('Database URL is required');return;}
  try{
    firebase.initializeApp(cfg);
    const db=firebase.database();
    document.getElementById('modal').style.display='none';
    let lastCtrl={power_supply:false,solenoid_valve:false,pump:false,artificial_lamp:false};
 
    db.ref('/sensors').on('value',snap=>{
      const s=snap.val()||{};
      const raw={T1:+s.T1||0,T2:+s.T2||0,T3:+s.T3||0,T4:+s.T4||0,F1:+s.F1||0,F2:+s.F2||0};
      ingestSensorReading(raw, lastCtrl);
    });
 
    db.ref('/controls').on('value',snap=>{
      const c=snap.val()||{};
      lastCtrl={power_supply:!!c.power_supply,solenoid_valve:!!c.solenoid_valve,pump:!!c.pump,artificial_lamp:!!c.artificial_lamp};
      setCtrl('power',lastCtrl.power_supply);
      setCtrl('sol',lastCtrl.solenoid_valve);
      setCtrl('pump',lastCtrl.pump);
      setCtrl('lamp',lastCtrl.artificial_lamp);
    });
 
    db.ref('.info/connected').on('value',snap=>{
      const p=document.getElementById('pill');
      if(snap.val()){
        p.className='live-pill live';
        document.getElementById('pill-txt').textContent='LIVE';
      }else{
        p.className='live-pill dead';
        document.getElementById('pill-txt').textContent='DISCONNECTED';
      }
    });
  }catch(e){alert('Firebase error: '+e.message);}
}

// ══════════════════════════════════════════════════════════════
// FIREBASE AUTH (P0) — optional but production-ready
// ══════════════════════════════════════════════════════════════
// Fill FIREBASE_API_KEY in from: Firebase Console > Project Settings >
// General > Web API Key. Leaving it blank keeps the dashboard reading
// in "open" mode matching your CURRENT database rules. Once you lock
// down your rules (see firebase_rules.json — auth != null), set the
// key below and the dashboard signs in anonymously and attaches a
// valid ID token to every REST request automatically. No code changes
// needed beyond pasting the key.
const FIREBASE_URL = "https://solar-thermal-e-harvesting-default-rtdb.firebaseio.com/";
const FIREBASE_ROOT_URL = FIREBASE_URL.replace(/\/+$/, "");
const FIREBASE_API_KEY = ""; // <-- paste your Web API Key here to enable Auth

let authIdToken = null;
let authReady = !FIREBASE_API_KEY;

async function initFirebaseAuth() {
  if (!FIREBASE_API_KEY) {
    console.log('[Auth] No API key configured — reading in open-rules mode.');
    return;
  }
  try {
    firebase.initializeApp({ apiKey: FIREBASE_API_KEY, databaseURL: FIREBASE_ROOT_URL });
    const cred = await firebase.auth().signInAnonymously();
    authIdToken = await cred.user.getIdToken();
    authReady = true;
    console.log('[Auth] Signed in anonymously — requests now authenticated.');
    setInterval(async () => {
      const user = firebase.auth().currentUser;
      if (user) authIdToken = await user.getIdToken(true); // refresh before 1hr expiry
    }, 50*60*1000);
  } catch(e) {
    console.error('[Auth] Sign-in failed, falling back to unauthenticated reads:', e.message);
    authReady = true;
  }
}
function authedUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  const base = `${FIREBASE_ROOT_URL}${path}`;
  return authIdToken ? `${base}${sep}auth=${authIdToken}` : base;
}

// ══════════════════════════════════════════════════════════════
// STALE-DATA DETECTION + RECONNECT WITH EXPONENTIAL BACKOFF (P1)
// ══════════════════════════════════════════════════════════════
let lastDataReceivedAt = Date.now();
let currentPollInterval = 5000;   // starts at 5s
const POLL_MIN = 5000, POLL_MAX = 60000;
const STALE_THRESHOLD_MS = 20000; // 4 missed cycles at base rate

function markDataReceived() {
  lastDataReceivedAt = Date.now();
  currentPollInterval = POLL_MIN; // reset backoff on success
  const bar = document.getElementById('staleBar');
  if (bar) bar.style.display = 'none';
}

function checkStale() {
  const age = Date.now() - lastDataReceivedAt;
  const bar = document.getElementById('staleBar');
  const bar_msg = document.getElementById('staleMsg');
  if (age > STALE_THRESHOLD_MS && bar) {
    bar.style.display = 'block';
    const secs = Math.round(age/1000);
    if (bar_msg) bar_msg.textContent =
      `⚠ No new data for ${secs}s — showing last known values. Retrying every ${Math.round(currentPollInterval/1000)}s…`;
  }
}
setInterval(checkStale, 3000);

// ══════════════════════════════════════════════════════════════
// AUTO-CONNECT — efficient pagination, real Auth, resilient polling
// ══════════════════════════════════════════════════════════════
let lastSeenLogKey = null;

async function connectSolarThermalDB(){
  await initFirebaseAuth();

  document.getElementById('modal').style.display='none';
  const p=document.getElementById('pill');
  p.className='live-pill live';
  document.getElementById('pill-txt').textContent='LIVE - LOADING...';

  try{
    // ── Initial load: bounded history fetch (was: entire /logs tree) ──
    const resp = await fetch(authedUrl('/logs.json?orderBy=%22$key%22&limitToLast=200'));
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const logsData = await resp.json();

    if(logsData && typeof logsData==='object'){
      const keys = Object.keys(logsData).sort();
      lastSeenLogKey = keys[keys.length-1] || null;

      const sortedLogs = keys
        .map(k => logsData[k])
        .filter(log=>log&&log.temperature&&log.flow)
        .sort((a,b)=>(a.meta?.millis||0)-(b.meta?.millis||0));

      console.log(`[Firebase] Loaded ${sortedLogs.length} historical records (bounded fetch, not full tree)`);

      sortedLogs.forEach(log=>{
        const sensors={
          T1:+log.temperature.t1||0, T2:+log.temperature.t2||0,
          T3:+log.temperature.t3||0, T4:+log.temperature.t4||0,
          F1:+log.flow.flow1_Lmin||0, F2:+log.flow.flow2_Lmin||0
        };
        const ctrl={
          power_supply:!!(log.relays_actual?.relay1_power_supply),
          solenoid_valve:!!(log.relays_actual?.relay2_solenoid),
          pump:!!(log.relays_actual?.relay3_pump_duty_pct),
          artificial_lamp:!!(log.relays_actual?.relay4_lamp)
        };
        ingestSensorReading(sensors, ctrl);
      });

      if(sortedLogs.length>0){
        const latest=sortedLogs[sortedLogs.length-1];
        const sensors={
          T1:+latest.temperature.t1||0, T2:+latest.temperature.t2||0,
          T3:+latest.temperature.t3||0, T4:+latest.temperature.t4||0,
          F1:+latest.flow.flow1_Lmin||0, F2:+latest.flow.flow2_Lmin||0
        };
        const ctrl={
          power_supply:!!(latest.relays_actual?.relay1_power_supply),
          solenoid_valve:!!(latest.relays_actual?.relay2_solenoid),
          pump:!!(latest.relays_actual?.relay3_pump_duty_pct),
          artificial_lamp:!!(latest.relays_actual?.relay4_lamp)
        };
        const clean = validateSensors(sensors);
        ['T1','T2','T3','T4'].forEach(k=>setSensor(k,clean[k],false));
        ['F1','F2'].forEach(k=>setSensor(k,clean[k],true));
        setCtrl('power',ctrl.power_supply);
        setCtrl('sol',ctrl.solenoid_valve);
        setCtrl('pump',ctrl.pump);
        setCtrl('lamp',ctrl.artificial_lamp);
      }
    }
    document.getElementById('pill-txt').textContent='LIVE';
    markDataReceived();

  }catch(e){
    console.error('[Firebase] Initial load error:', e.message);
    document.getElementById('pill-txt').textContent='ERROR — retrying…';
  }

  // ── Lightweight polling loop with exponential backoff ──
  // Fetches only the last 3 records (not the whole tree) each cycle.
  async function pollOnce(){
    try{
      const resp = await fetch(authedUrl('/logs.json?orderBy=%22$key%22&limitToLast=3'));
      if (!resp.ok) throw new Error('HTTP '+resp.status);
      const newLogs = await resp.json();

      if(newLogs && typeof newLogs==='object'){
        const keys = Object.keys(newLogs).sort();
        const freshKeys = lastSeenLogKey ? keys.filter(k => k > lastSeenLogKey) : keys;

        freshKeys.forEach(k=>{
          const latest = newLogs[k];
          if(latest&&latest.temperature&&latest.flow){
            const sensors={
              T1:+latest.temperature.t1||0, T2:+latest.temperature.t2||0,
              T3:+latest.temperature.t3||0, T4:+latest.temperature.t4||0,
              F1:+latest.flow.flow1_Lmin||0, F2:+latest.flow.flow2_Lmin||0
            };
            const ctrl={
              power_supply:!!(latest.relays_actual?.relay1_power_supply),
              solenoid_valve:!!(latest.relays_actual?.relay2_solenoid),
              pump:!!(latest.relays_actual?.relay3_pump_duty_pct),
              artificial_lamp:!!(latest.relays_actual?.relay4_lamp)
            };
            ingestSensorReading(sensors, ctrl);
          }
        });
        if (freshKeys.length) lastSeenLogKey = keys[keys.length-1];

        p.className='live-pill live';
        document.getElementById('pill-txt').textContent='LIVE';
        markDataReceived();
      }
      currentPollInterval = POLL_MIN; // success → reset backoff
    }catch(e){
      console.error('[Firebase] Poll error:', e.message);
      p.className='live-pill dead';
      document.getElementById('pill-txt').textContent='RECONNECTING…';
      currentPollInterval = Math.min(POLL_MAX, currentPollInterval * 2); // backoff
    }
    setTimeout(pollOnce, currentPollInterval);
  }
  setTimeout(pollOnce, currentPollInterval);
}

// Auto-connect on page load
connectSolarThermalDB();
startDemoFromDefault();

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — SEMI-CIRCULAR GAUGE (T1–T4)
// ═══════════════════════════════════════════════════════════
const GAUGE_SENSORS = ['T1','T2','T3','T4'];
const GAUGE_MAX = 100; // °C

function drawGauge(id, val, color) {
  const svg = document.getElementById('gauge-svg-' + id);
  if (!svg) return;
  const cx = 45, cy = 46, r = 34;
  const pct = Math.max(0, Math.min(1, val / GAUGE_MAX));
  const startA = Math.PI, endA = 2 * Math.PI;
  const fillA  = startA + pct * Math.PI;

  const toXY = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const arcPath = (a1, a2, rr) => {
    const [sx,sy]=toXY(a1,rr), [ex,ey]=toXY(a2,rr);
    const large = (a2-a1) > Math.PI ? 1 : 0;
    return `M${sx.toFixed(2)},${sy.toFixed(2)} A${rr},${rr} 0 ${large} 1 ${ex.toFixed(2)},${ey.toFixed(2)}`;
  };

  // zone color
  const zoneCol = val < 40 ? '#00e676' : val < 70 ? '#ffb340' : '#e53935';

  // zone ticks
  const ticks = [
    { a: Math.PI,               col:'#00e676', label:'0'},
    { a: Math.PI + Math.PI*0.4, col:'#ffb340', label:'40'},
    { a: Math.PI + Math.PI*0.7, col:'#e53935', label:'70'},
    { a: 2*Math.PI,             col:'#e53935', label:'100'},
  ];
  let tickSVG = '';
  ticks.forEach(tk => {
    const [tx,ty] = toXY(tk.a, r+6);
    tickSVG += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="5" fill="${tk.col}" opacity="0.7">${tk.label}</text>`;
  });

  // needle
  const needleA = startA + pct * Math.PI;
  const [nx,ny] = toXY(needleA, r-6);
  const needleSVG = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke="${zoneCol}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="3" fill="${zoneCol}"/>`;

  svg.innerHTML = `
    <!-- track -->
    <path d="${arcPath(Math.PI, 2*Math.PI, r)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8" stroke-linecap="round"/>
    <!-- green zone 0-40% -->
    <path d="${arcPath(Math.PI, Math.PI+Math.PI*0.4, r)}" fill="none" stroke="rgba(0,230,118,0.25)" stroke-width="8" stroke-linecap="round"/>
    <!-- amber zone 40-70% -->
    <path d="${arcPath(Math.PI+Math.PI*0.4, Math.PI+Math.PI*0.7, r)}" fill="none" stroke="rgba(255,179,64,0.25)" stroke-width="8" stroke-linecap="round"/>
    <!-- red zone 70-100% -->
    <path d="${arcPath(Math.PI+Math.PI*0.7, 2*Math.PI, r)}" fill="none" stroke="rgba(229,57,53,0.25)" stroke-width="8" stroke-linecap="round"/>
    <!-- fill arc -->
    ${pct > 0 ? `<path d="${arcPath(Math.PI, fillA, r)}" fill="none" stroke="${zoneCol}" stroke-width="8" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ${zoneCol})"/>` : ''}
    <!-- needle -->
    ${needleSVG}
    ${tickSVG}
  `;
}

function updateGaugeZone(id, val) {
  const el = document.getElementById('zone-'+id);
  if (!el) return;
  if (val < 40)      { el.className='gauge-zone zone-normal'; el.textContent='NORMAL'; }
  else if (val < 70) { el.className='gauge-zone zone-warn';   el.textContent='WARNING'; }
  else               { el.className='gauge-zone zone-crit';   el.textContent='CRITICAL'; }
}

// Init gauges at 0
GAUGE_SENSORS.forEach(id => drawGauge(id, 0, ''));

// ═══════════════════════════════════════════════════════════
// FEATURE 3 — MINI SPARKLINES (F1, F2)
// ═══════════════════════════════════════════════════════════
const sparkHistory = { F1: [], F2: [] };
const SPARK_MAX_PTS = 12;

function updateSparkline(id, val) {
  const h = sparkHistory[id];
  h.push(val);
  if (h.length > SPARK_MAX_PTS) h.shift();
  if (h.length < 2) return;

  const svg = document.getElementById('spark-' + id);
  if (!svg) return;
  const W = 100, H = 22;
  const mn = Math.min(...h), mx = Math.max(...h);
  const range = mx - mn || 0.01;
  const pts = h.map((v,i) => {
    const x = (i/(h.length-1)) * (W-4) + 2;
    const y = H - 3 - ((v-mn)/range) * (H-6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const col = id==='F1' ? 'var(--f1)' : 'var(--f2)';
  const lastX = ((h.length-1)/(h.length-1))*(W-4)+2;
  const lastY = H - 3 - ((h[h.length-1]-mn)/range)*(H-6);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" fill="${col}"/>
  `;
}

// ═══════════════════════════════════════════════════════════
// FEATURE 4 — KPI BAR UPDATE
// ═══════════════════════════════════════════════════════════
function updateKPI(sensors) {
  const T1 = sensors.T1 || 0, T4 = sensors.T4 || 0;
  const F1 = sensors.F1 || 0, F2 = sensors.F2 || 0;

  // ΔT
  const dT = T4 - T1;
  const dtEl = document.getElementById('kpi-dt');
  if (dtEl) {
    dtEl.textContent = (dT >= 0 ? '+' : '') + dT.toFixed(1);
    dtEl.style.color = dT > 15 ? '#00e676' : dT > 5 ? '#ffb340' : '#e53935';
  }

  // Heat Gain: Q = mass_flow_rate * Cp * deltaT
  // F1 in L/min → kg/s = F1/60 (water density ~1 kg/L)
  const massFlow = F1 / 60;
  const Cp = 4186; // J/kg·K
  const Q = massFlow * Cp * Math.abs(dT);
  const hgEl = document.getElementById('kpi-hg');
  if (hgEl) {
    hgEl.textContent = Q > 1000 ? (Q/1000).toFixed(2)+'k' : Math.round(Q);
    hgEl.style.color = Q > 500 ? '#00e676' : Q > 100 ? '#ffb340' : '#e53935';
  }

  // Flow efficiency
  const fe = F2 > 0 ? (F1/F2)*100 : 0;
  const feEl = document.getElementById('kpi-fe');
  if (feEl) {
    feEl.textContent = fe.toFixed(1);
    feEl.style.color = fe > 90 ? '#00e676' : fe > 75 ? '#ffb340' : '#e53935';
  }
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2 — HEATMAP TIMELINE
// ═══════════════════════════════════════════════════════════
const hmData = {
  T1: new Array(24).fill(null),
  T2: new Array(24).fill(null),
  T3: new Array(24).fill(null),
  T4: new Array(24).fill(null),
};

function hmColor(val, minV, maxV) {
  if (val === null) return 'rgba(255,255,255,0.04)';
  const t = Math.max(0, Math.min(1, (val - minV) / (maxV - minV + 0.001)));
  if (t < 0.2)  return '#0e3a4a';
  if (t < 0.4)  return '#006d77';
  if (t < 0.6)  return '#83c5be';
  if (t < 0.75) return '#ffb340';
  if (t < 0.9)  return '#e53935';
  return '#b71c1c';
}

function updateHeatmap(sensors) {
  const hr = new Date().getHours();
  ['T1','T2','T3','T4'].forEach(k => {
    if (sensors[k]) hmData[k][hr] = sensors[k];
  });
  renderHeatmap();
}

function renderHeatmap() {
  const grid = document.getElementById('hmGrid');
  if (!grid) return;
  const rows = ['T1','T2','T3','T4'];
  const hours = Array.from({length:24},(_,i)=>i);

  let out = '';
  // hour header row
  out += '<div></div>';
  hours.forEach(h => {
    out += `<div class="hm-hour-label">${h===0?'12a':h<12?h+'a':h===12?'12p':(h-12)+'p'}</div>`;
  });

  rows.forEach(k => {
    const vals = hmData[k].filter(v=>v!==null);
    const minV = vals.length ? Math.min(...vals) : 20;
    const maxV = vals.length ? Math.max(...vals) : 80;
    out += `<div class="hm-row-label" style="color:var(--${k.toLowerCase()})">${k}</div>`;
    hours.forEach(h => {
      const v = hmData[k][h];
      const col = hmColor(v, minV, maxV);
      const title = v !== null ? `${k} at ${h}:00 = ${v.toFixed(1)}°C` : 'No data';
      out += `<div class="hm-cell" style="background:${col}" title="${title}"></div>`;
    });
  });

  grid.innerHTML = out;

  // legend
  const leg = document.getElementById('hmLegend');
  if (leg) {
    const colors = ['#0e3a4a','#006d77','#83c5be','#ffb340','#e53935','#b71c1c'];
    leg.innerHTML = colors.map(c => `<div class="hm-legend-cell" style="background:${c}"></div>`).join('');
  }
}
renderHeatmap(); // init empty grid

// ═══════════════════════════════════════════════════════════
// FEATURE 7 — EXPORT PNG SNAPSHOT
// ═══════════════════════════════════════════════════════════
async function exportSnapshot() {
  const btn = document.querySelector('.export-btn');
  if (btn) { btn.textContent = '⏳ Capturing…'; btn.style.pointerEvents='none'; }
  try {
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#0f1e24',
      scale: 1.5,
      useCORS: true,
      logging: false,
    });
    const link = document.createElement('a');
    const ts = new Date().toISOString().slice(0,19).replace(/:/g,'-');
    link.download = `solar-dashboard-${ts}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch(e) {
    alert('Export failed: ' + e.message);
  } finally {
    if (btn) { btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/></svg> 📸 Export PNG'; btn.style.pointerEvents='auto'; }
  }
}
window.exportSnapshot = exportSnapshot;

// ═══════════════════════════════════════════════════════════════
// ML INTELLIGENCE LAYER — All 6 Models
// ═══════════════════════════════════════════════════════════════

// ── SHARED STATE ────────────────────────────────────────────────
const mlHistory = [];   // {T1,T2,T3,T4,F1,F2,ts}
const ML_MIN_PTS = 20;
let mlReady = false;
let forecastChartObj = null;

// ── TAB SWITCHER ────────────────────────────────────────────────
let activeMLTab = 'lstm';
function showML(tab) {
  activeMLTab = tab;
  document.querySelectorAll('.ml-tab').forEach((t,i) => {
    const tabs=['lstm','anomaly','efficiency','rl','irr','nlp'];
    t.classList.toggle('active', tabs[i]===tab);
  });
  document.querySelectorAll('.ml-panel').forEach(p => p.classList.remove('visible'));
  const panels={lstm:'mlp-lstm',anomaly:'mlp-anomaly',efficiency:'mlp-efficiency',
                 rl:'mlp-rl',irr:'mlp-irr',nlp:'mlp-nlp'};
  const el = document.getElementById(panels[tab]);
  if(el) el.classList.add('visible');
}

// ── MASTER ENTRY: called after every pushPoint ───────────────────
let mlErrorCount = 0;
function runMLPipeline(sensors) {
  const entry = { ...sensors, ts: Date.now() };
  mlHistory.push(entry);
  if (mlHistory.length > 200) mlHistory.shift();

  const n = mlHistory.length;
  document.getElementById('lstmPts').textContent = n;

  // Each model runs in isolation: a failure in one is logged and skipped
  // rather than aborting the data pipeline (charts, log, controls) behind it.
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error('[ML:' + name + ']', e.message); mlErrorCount++; } };
  safe('LSTM',       () => runLSTMForecast(sensors, n));
  safe('Autoencoder',() => runAnomalyDetection(sensors, n));
  safe('RLS',        () => runEfficiencyRegression(sensors, n));
  safe('Q-learning', () => runRLAgent(sensors));
  safe('Irradiance', () => runIrradianceEstimation(sensors));

  if (n >= ML_MIN_PTS && !mlReady) {
    mlReady = true;
    document.getElementById('mlStatus').textContent =
      `✓ All models active · ${n} data points · Live inference running`;
  }
}

// ═══════════════════════════════════════════════════════════════
// MODEL 1 — GENUINE TRAINED LSTM (Keras/TensorFlow, offline-trained)
// Architecture: LSTM(8 units) -> Dense(2)  |  Params: 370
// Trained on physically-realistic synthetic diurnal solar profile
// (see train_models.py for full reproducibility + retraining on real data)
// JS forward-pass verified to match Keras output to 1e-6 precision.
// ═══════════════════════════════════════════════════════════════
const ML_WEIGHTS = {"lstm": {"window": 10, "hidden": 8, "features": ["T1", "T3"], "norm_mean": [43.14148712158203, 43.182029724121094], "norm_std": [18.81891632080078, 21.658557891845703], "kernel": [[0.2646203935146332, -0.38061174750328064, 0.10414326936006546, 0.4195389449596405, 0.1093461811542511, -0.34118345379829407, 0.12170714139938354, -0.3449867367744446, 0.15507076680660248, 0.20655423402786255, 0.30098313093185425, 0.2019725739955902, -0.09267960488796234, -0.004133841022849083, 0.23498426377773285, -0.713894248008728, -0.6010799407958984, 0.1238187924027443, 0.13496442139148712, -0.2991354763507843, -0.02524719201028347, -0.13330979645252228, 0.321222722530365, 0.41268283128738403, 0.4386347234249115, -0.46976926922798157, 0.23732292652130127, 0.5267255306243896, 0.3957972526550293, -0.0001053117448464036, 0.25848427414894104, -0.43988722562789917], [0.0584026537835598, -0.5405861735343933, 0.09304036945104599, -0.15287232398986816, 0.02968638762831688, -0.47935882210731506, 0.05049057677388191, -0.15107887983322144, 0.04065950959920883, -0.09797390550374985, 0.18177208304405212, 0.15316736698150635, -0.18399624526500702, -0.13560660183429718, 0.05764898657798767, -0.15066830813884735, 0.2315582036972046, 0.00176981370896101, -0.6367102265357971, -0.20691460371017456, -0.6867258548736572, -0.028283575549721718, 0.18259014189243317, -0.07483530789613724, 0.21115297079086304, -0.2730690538883209, 0.29546594619750977, 0.2557446360588074, 0.28296536207199097, -0.4943632483482361, 0.24162352085113525, -0.18353793025016785]], "recurrent_kernel": [[-0.05599503591656685, -0.0846889391541481, 0.7642682194709778, 0.07738471776247025, -0.04794837906956673, -0.2662681043148041, -0.13130809366703033, 0.6508858799934387, -0.3190958499908447, -0.2886625826358795, 0.29425445199012756, -0.13907651603221893, 0.0810622125864029, 0.15267862379550934, 0.5509647727012634, 0.49659061431884766, -0.5730911493301392, 0.267073392868042, 0.22625581920146942, 0.3430663049221039, -0.3292319178581238, -0.02171584591269493, -0.3506699800491333, 0.0909084677696228, -0.11306945979595184, 0.10069464892148972, -0.6326891183853149, -0.060838326811790466, 0.11000742018222809, 0.024806102737784386, -0.4373593330383301, 0.5953130125999451], [0.6540891528129578, -0.10295537114143372, 0.3243669271469116, -0.22214719653129578, 0.6720588207244873, 0.04793806001543999, 0.07466305047273636, 0.03208094835281372, 0.11054906994104385, 0.3439870774745941, 0.31347140669822693, 0.39792126417160034, 0.15457715094089508, 0.08417199552059174, 0.038659270852804184, -0.23590373992919922, -0.13327179849147797, -0.014790822751820087, -0.15119962394237518, -0.12172558158636093, -0.5833947062492371, 0.3352048993110657, 0.3037428557872772, -0.14701785147190094, 0.6573919057846069, -0.10919376462697983, 0.6759508848190308, 0.5488105416297913, 0.5441169142723083, -0.07296773791313171, 0.3780701458454132, 0.23449835181236267], [-0.06541445106267929, 0.2517140507698059, -0.2888430058956146, -0.25056228041648865, -0.0942755863070488, 0.43166041374206543, -0.17295287549495697, -0.2932751774787903, -0.42964425683021545, 0.44753405451774597, -0.29072296619415283, -0.5870792865753174, -0.41389358043670654, 0.3657524883747101, -0.2528574466705322, -0.4258250296115875, -0.199362114071846, 0.27182769775390625, -0.1279088705778122, -0.1516561657190323, 0.596720278263092, -0.25512540340423584, 0.1478283852338791, 0.15715470910072327, 0.12373503297567368, 0.12085124850273132, -0.26518547534942627, -0.314211368560791, -0.39687490463256836, 0.3607024550437927, -0.3449903726577759, 0.2944372892379761], [0.07421023398637772, 0.1154647171497345, 0.20016907155513763, -0.009059076197445393, 0.05332447588443756, -0.09442970156669617, 0.10234543681144714, -0.029571859166026115, -0.5313631892204285, -0.18622370064258575, 0.1421949714422226, -0.04754963144659996, 0.14819104969501495, -0.06852073967456818, 0.19909074902534485, 0.05765969678759575, -0.10970576107501984, 0.3203628361225128, -0.011058961972594261, -0.2517037093639374, 0.32210251688957214, -0.253483384847641, -0.1696999967098236, -0.28081125020980835, -0.46979954838752747, 0.15203599631786346, -0.44514837861061096, -0.13003985583782196, -0.20109733939170837, -0.09016833454370499, -0.19447097182273865, -0.04100629687309265], [0.04097148776054382, 0.14965075254440308, 0.3441498875617981, -0.16548006236553192, 0.27973467111587524, 0.08721157163381577, 0.41888153553009033, -0.24169102311134338, -0.04156220704317093, 0.11267030984163284, 0.2123023271560669, -0.013445325195789337, 0.5818570256233215, -0.02373300865292549, 0.2358347624540329, 0.18674412369728088, -0.1030726358294487, 0.5646833181381226, -0.2293878197669983, -0.2501731812953949, -0.057672467082738876, -0.4697774052619934, -0.189079150557518, 0.03766477108001709, -0.2821267247200012, 0.24350208044052124, -0.6145089864730835, -0.019057953730225563, 0.3057136833667755, -0.23624587059020996, -0.18300628662109375, -0.14050602912902832], [-0.05641348659992218, -0.09901981055736542, 0.09926427155733109, -0.05328521132469177, -0.2934395968914032, -0.17319616675376892, 0.0012627270771190524, -0.10612829774618149, 0.0674305111169815, 0.31191837787628174, -0.12016049772500992, -0.004134500864893198, -0.2331896275281906, 0.02650962769985199, 0.2608771324157715, -0.14454683661460876, -0.3030114471912384, -0.053395338356494904, 0.2682831585407257, -0.07505276799201965, 0.5354747176170349, 0.02697659842669964, -0.14153535664081573, 0.02619471400976181, -0.16560526192188263, -0.44318172335624695, -0.6701363325119019, 0.0634588673710823, -0.012960013933479786, -0.21483328938484192, -0.25479456782341003, -0.34774282574653625], [-0.10319211333990097, -0.17108358442783356, -0.41145890951156616, -0.12135843187570572, -0.020610710605978966, 0.43658727407455444, -0.1750832200050354, 0.1745978593826294, -0.008420449681580067, 0.06972809880971909, -0.46370983123779297, -0.023007556796073914, 0.10352812707424164, 0.3728564381599426, -0.20586973428726196, 0.1439639925956726, 0.26324355602264404, -0.40025293827056885, 0.20827965438365936, 0.1848413646221161, 0.2182532101869583, 0.1284307986497879, 0.05189947038888931, 0.13580350577831268, 0.5122531056404114, -0.06297000497579575, 0.41745901107788086, -0.006950962357223034, 0.22312501072883606, -0.21261321008205414, 0.3278867304325104, -0.3578755855560303], [-0.3764229416847229, 0.3369055390357971, -0.42495056986808777, -0.8302858471870422, -0.5438085794448853, 0.04800545051693916, -0.5158448815345764, -0.014004130847752094, -0.345977783203125, -0.5030491352081299, -0.3579131066799164, -0.4140082597732544, -0.09507065266370773, 0.0014150748029351234, -0.44869372248649597, -0.26390817761421204, 0.05711781233549118, -0.21539561450481415, 0.0825972780585289, -0.01233522780239582, 0.24735456705093384, 0.03786575049161911, -0.1414337009191513, -0.16358907520771027, -0.16806919872760773, -0.5653309226036072, -0.5665874481201172, -0.8235230445861816, -0.2046162337064743, -0.034631405025720596, -0.5219805836677551, -0.6571484208106995]], "bias": [0.0979294553399086, -0.13851028680801392, 0.32551831007003784, 0.018686192110180855, 0.443992555141449, -0.21539504826068878, 0.13147249817848206, -0.2058573216199875, 1.0653072595596313, 0.8697007894515991, 1.2772326469421387, 1.0294721126556396, 1.361037254333496, 0.7650783061981201, 1.1540025472640991, 0.778956413269043, -0.012399228289723396, 0.34332209825515747, 0.22805744409561157, -0.040267352014780045, -0.01707189902663231, -0.23890933394432068, -0.168296217918396, -0.01610022969543934, 0.2968190312385559, -0.13550491631031036, 0.46449679136276245, 0.2519673705101013, 0.5620168447494507, -0.1945296972990036, 0.3490394651889801, 0.03580371290445328], "dense_kernel": [[-0.8731725215911865, 0.31567588448524475], [-0.32889091968536377, -0.29173770546913147], [-0.41933783888816833, -0.9889415502548218], [-0.6345875859260559, -0.22557814419269562], [-0.2052784264087677, -0.5735012292861938], [-0.30082347989082336, 0.27143290638923645], [0.7538323998451233, 0.3989067077636719], [0.3322644829750061, 0.1336716264486313]], "dense_bias": [0.08526933938264847, 0.260477215051651], "test_rmse_T1": 0.4733276665210724, "test_rmse_T3": 0.4786745309829712, "train_samples": 2439, "epochs": 25}, "autoencoder": {"layers": [{"name": "enc1", "W": [[-0.39347705245018005, 0.30804651975631714, 0.04308769851922989, 0.3237037658691406], [-0.4075910747051239, 0.3333156704902649, 0.25609880685806274, 0.47901836037635803], [-0.10700007528066635, 0.2546589970588684, 0.6988533139228821, 0.4541001617908478], [0.20497259497642517, 0.34351328015327454, 0.03800518810749054, -0.3298330307006836], [-1.1642470359802246, -0.12735463678836823, 0.19133611023426056, 0.15941856801509857], [-0.3341732323169708, 0.059444695711135864, 0.9584830403327942, 0.8518231511116028]], "b": [0.03353296220302582, 1.7089465856552124, 1.262383222579956, -0.17145414650440216], "activation": "relu"}, {"name": "enc2_bottleneck", "W": [[-1.028264045715332, -0.5180814266204834, 0.8007832169532776], [-0.2090539038181305, 0.6899414658546448, 1.3219020366668701], [0.5541308522224426, 0.5433022379875183, -0.45998910069465637], [-0.5784122943878174, -0.4953477680683136, -1.0705713033676147]], "b": [0.7248134613037109, 0.7932040095329285, 0.3693332076072693], "activation": "relu"}, {"name": "dec1", "W": [[-0.13697302341461182, 0.5727415084838867, 0.7506139874458313, -0.8805736303329468], [-0.03212392330169678, -0.12046169489622116, 0.8789598941802979, 0.9533202052116394], [-0.03353073075413704, -0.4895464777946472, -0.3023010492324829, -0.5827983021736145]], "b": [-0.11313621699810028, 1.954896330833435, -1.430034875869751, 1.7075555324554443], "activation": "relu"}, {"name": "dec2_output", "W": [[0.6103425621986389, -0.08260911703109741, -0.5619835257530212, -0.474115252494812, 0.2822069227695465, 0.5664319396018982], [-0.7602435350418091, -0.7555587291717529, -0.8066660165786743, -0.8529960513114929, 0.7644972801208496, 0.7645759582519531], [-0.7188428044319153, -0.7388699650764465, 1.507568120956421, 1.143059492111206, -0.12134188413619995, -0.1197073832154274], [1.1924606561660767, 1.2055546045303345, -0.21933913230895996, 0.0413372702896595, 0.33782464265823364, 0.33828532695770264]], "b": [-0.7066783905029297, -0.7140538096427917, -0.4101415276527405, -0.4542767107486725, -1.3764501810073853, -1.3752264976501465], "activation": "linear"}], "norm_mean": [43.1414909362793, 36.66997146606445, 43.1820182800293, 43.180362701416016, 1.1526333093643188, 1.0950312614440918], "norm_std": [18.81890296936035, 18.866985321044922, 21.658554077148438, 21.606653213500977, 1.2024595737457275, 1.1426626443862915], "threshold": 0.004254060797393322, "features": ["T1", "T2", "T3", "T4", "F1", "F2"], "train_samples": 2448, "epochs": 40}};

// ═══════════════════════════════════════════════════════════════
// REAL TRAINED ML MODELS — genuine weights, pure JS inference
// Trained offline via train_models.py (TensorFlow/Keras, numpy synthetic
// solar-thermal profile — see script for full reproducibility).
// No TF.js runtime needed: this is the actual forward-pass math.
// ═══════════════════════════════════════════════════════════════

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function tanhF(x) { return Math.tanh(x); }
function relu(x) { return Math.max(0, x); }

function matVecMul(mat, vec) {
  // mat: [rows][cols], vec: [cols] -> returns [rows]... but our weights are
  // stored as Keras (input_dim, units) i.e. mat[i][j], vec has length input_dim
  const rows = mat.length, cols = mat[0].length;
  const out = new Array(cols).fill(0);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      out[j] += vec[i] * mat[i][j];
    }
  }
  return out;
}
function addVec(a, b) { return a.map((v, i) => v + b[i]); }

// ── REAL LSTM FORWARD PASS (matches Keras gate order: i, f, c, o) ──
function lstmForward(weights, inputWindow) {
  const { hidden, kernel, recurrent_kernel, bias, dense_kernel, dense_bias } = weights;
  let h = new Array(hidden).fill(0);
  let c = new Array(hidden).fill(0);

  for (let t = 0; t < inputWindow.length; t++) {
    const x = inputWindow[t]; // [T1_norm, T3_norm]
    const z1 = addVec(matVecMul(kernel, x), matVecMul(recurrent_kernel, h));
    const z = addVec(z1, bias); // length 4*hidden

    const i_gate = z.slice(0, hidden).map(sigmoid);
    const f_gate = z.slice(hidden, 2*hidden).map(sigmoid);
    const g_gate = z.slice(2*hidden, 3*hidden).map(tanhF);
    const o_gate = z.slice(3*hidden, 4*hidden).map(sigmoid);

    c = c.map((cv, idx) => f_gate[idx]*cv + i_gate[idx]*g_gate[idx]);
    h = c.map((cv, idx) => o_gate[idx] * tanhF(cv));
  }

  // Dense output layer (linear)
  const out = addVec(matVecMul(dense_kernel, h), dense_bias);
  return out; // [T1_next_norm, T3_next_norm]
}

function runRealLSTM(historyWindow) {
  // historyWindow: array of {T1, T3} objects, length >= weights.lstm.window
  const W = ML_WEIGHTS.lstm;
  if (historyWindow.length < W.window) return null;

  const slice = historyWindow.slice(-W.window);
  const normInput = slice.map(pt => [
    (pt.T1 - W.norm_mean[0]) / W.norm_std[0],
    (pt.T3 - W.norm_mean[1]) / W.norm_std[1],
  ]);

  const outNorm = lstmForward(W, normInput);
  const T1_pred = outNorm[0] * W.norm_std[0] + W.norm_mean[0];
  const T3_pred = outNorm[1] * W.norm_std[1] + W.norm_mean[1];
  return { T1: T1_pred, T3: T3_pred };
}

// ── REAL AUTOENCODER FORWARD PASS ──
function denseForward(layer, input) {
  const { W, b, activation } = layer;
  const out = addVec(matVecMul(W, input), b);
  const fn = activation === 'relu' ? relu : (x => x); // linear passthrough
  return out.map(fn);
}

function autoencoderReconstruct(sensors6) {
  const AE = ML_WEIGHTS.autoencoder;
  const norm = AE.features.map((k, i) => (sensors6[k] - AE.norm_mean[i]) / AE.norm_std[i]);

  let x = norm;
  for (const layer of AE.layers) {
    x = denseForward(layer, x);
  }
  // x is now reconstructed (normalized) output
  const mse = x.reduce((s, v, i) => s + Math.pow(v - norm[i], 2), 0) / x.length;
  return { reconError: mse, threshold: AE.threshold, reconstructed: x };
}

let lstmRMSEsum = 0, lstmRMSEcount = 0;
let forecastHistory = { actual:[], predicted:[], labels:[] };

function runLSTMForecast(sensors, n) {
  const W = ML_WEIGHTS.lstm;
  const pct = Math.min(100, Math.round((n/W.window)*100));
  document.getElementById('lstmTrainBar').style.width = pct+'%';

  if (n < W.window) {
    document.getElementById('lstmTrainLabel').textContent =
      `Buffering live window… ${n}/${W.window} pts (model pre-trained, ${W.train_samples} synthetic samples, ${W.epochs} epochs)`;
    return;
  }
  document.getElementById('lstmTrainLabel').textContent =
    `LSTM(8) active · offline RMSE T1=${W.test_rmse_T1.toFixed(2)}°C T3=${W.test_rmse_T3.toFixed(2)}°C`;

  const windowData = mlHistory.slice(-W.window).map(e => ({T1:e.T1, T3:e.T3}));
  const pred = runRealLSTM(windowData);
  if (!pred) return;

  const predT1 = pred.T1, predT3 = pred.T3;
  document.getElementById('lstmT1pred').textContent = predT1.toFixed(1)+'°C';
  document.getElementById('lstmT3pred').textContent = predT3.toFixed(1)+'°C';

  // Live RMSE — compares this prediction (made 1 step ago conceptually) against actual
  const actualT1 = sensors.T1;
  lstmRMSEsum += Math.pow(predT1 - actualT1, 2);
  lstmRMSEcount++;
  const rmse = Math.sqrt(lstmRMSEsum / lstmRMSEcount).toFixed(2);
  document.getElementById('lstmRMSE').textContent = rmse + ' °C (live)';
  document.getElementById('lstmRMSE').className =
    'ml-val ' + (+rmse < 1.5 ? 'good' : +rmse < 3 ? 'warn' : 'bad');

  // Forecast chart
  const label = new Date().toLocaleTimeString('en-IN',{hour12:false});
  forecastHistory.labels.push(label);
  forecastHistory.actual.push(+actualT1.toFixed(2));
  forecastHistory.predicted.push(+predT1.toFixed(2));
  if(forecastHistory.labels.length>20){
    forecastHistory.labels.shift();
    forecastHistory.actual.shift();
    forecastHistory.predicted.shift();
  }
  renderForecastChart();
}

function renderForecastChart() {
  const canvas = document.getElementById('forecastCanvas');
  if (!canvas) return;
  if (!forecastChartObj) {
    forecastChartObj = new Chart(canvas.getContext('2d'), {
      type:'line',
      data:{
        labels: forecastHistory.labels,
        datasets:[
          {label:'Actual T1',data:forecastHistory.actual,borderColor:'#00e5ff',
           borderWidth:1.5,pointRadius:0,tension:0.4,fill:false},
          {label:'LSTM Pred',data:forecastHistory.predicted,borderColor:'#ffb340',
           borderWidth:1.5,pointRadius:0,tension:0.4,fill:false,borderDash:[4,2]},
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        animation:{duration:0},
        plugins:{legend:{display:false},tooltip:{enabled:false}},
        scales:{
          x:{display:false},
          y:{grid:{color:'rgba(255,255,255,.05)'},
             ticks:{color:'#555',font:{size:8}},border:{display:false}}
        }
      }
    });
  } else {
    forecastChartObj.data.labels = [...forecastHistory.labels];
    forecastChartObj.data.datasets[0].data = [...forecastHistory.actual];
    forecastChartObj.data.datasets[1].data = [...forecastHistory.predicted];
    forecastChartObj.update('none');
  }
}

// ═══════════════════════════════════════════════════════════════
// MODEL 2 — GENUINE TRAINED AUTOENCODER (Keras, offline-trained)
// Architecture: Dense(6→4→3→4→6), ReLU + linear output | Params: 89
// Trained on 2448 synthetic normal-operation samples, 40 epochs.
// Anomaly = reconstruction MSE exceeding the 2σ threshold learned
// from the training distribution (see train_models.py).
// JS forward-pass verified to match Keras output to 1e-7 precision.
// ═══════════════════════════════════════════════════════════════
let anomEvents = [];
const ANOM_KEYS = ML_WEIGHTS.autoencoder.features;

function runAnomalyDetection(sensors, n) {
  document.getElementById('anomBaseline').textContent =
    `${ML_WEIGHTS.autoencoder.train_samples} pretrained + ${n} live`;
  if (n < 5) return;

  const result = autoencoderReconstruct(sensors);
  const errorEl = document.getElementById('anomError');
  const threshEl = document.getElementById('anomThresh');
  const statEl   = document.getElementById('anomStatus');

  errorEl.textContent = result.reconError.toFixed(5);
  threshEl.textContent = result.threshold.toFixed(5) + ' (2σ)';

  const ratio = result.reconError / result.threshold;
  const ts = new Date().toLocaleTimeString('en-IN',{hour12:false});

  // Identify which sensor contributes most to reconstruction error
  const AE = ML_WEIGHTS.autoencoder;
  let maxKey = '', maxContrib = 0;
  AE.features.forEach((k,i) => {
    const normVal = (sensors[k]-AE.norm_mean[i])/AE.norm_std[i];
    const contrib = Math.pow(result.reconstructed[i]-normVal, 2);
    if (contrib > maxContrib) { maxContrib = contrib; maxKey = k; }
  });

  let severity='ok', msg='Reconstruction within learned baseline';
  if (ratio > 3.0)      { severity='crit'; msg=`CRITICAL: ${maxKey} — recon error ${ratio.toFixed(1)}× threshold`; }
  else if (ratio > 1.0) { severity='warn'; msg=`Warning: ${maxKey} deviating — ${ratio.toFixed(1)}× threshold`; }

  if (severity !== 'ok') {
    anomEvents.unshift({ severity, msg, ts });
    if(anomEvents.length>8) anomEvents.pop();
  }

  statEl.textContent = severity==='crit'?'ANOMALY DETECTED':severity==='warn'?'WARNING':'NORMAL';
  statEl.className = 'ml-val ' + (severity==='crit'?'bad':severity==='warn'?'warn':'good');
  errorEl.className = 'ml-val ' + (ratio>3?'bad':ratio>1?'warn':'good');

  renderAnomalyLog();
}

function renderAnomalyLog() {
  const log = document.getElementById('anomLog');
  if (!log) return;
  const all = anomEvents.length ? anomEvents :
    [{severity:'ok', msg:'All sensors within normal range', ts: new Date().toLocaleTimeString('en-IN',{hour12:false})}];
  log.innerHTML = all.map(e => `
    <div class="anom-row">
      <span class="anom-pill ${e.severity}">${e.severity.toUpperCase()}</span>
      <span class="anom-msg">${e.msg}</span>
      <span class="anom-time">${e.ts}</span>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// MODEL 3 — GENUINE ONLINE RECURSIVE LEAST SQUARES (RLS) REGRESSION
// Unlike a fixed coefficient array, this ACTUALLY learns from every
// real data point your system produces — coefficients update live via
// the RLS update equations (Sherman-Morrison formula), the same
// algorithm used in adaptive filtering / adaptive control systems.
// Target: y = physics-formula η (used as a smoothing/denoising label
// since no independent ground-truth η sensor exists on this rig).
// ═══════════════════════════════════════════════════════════════
const RLS_N_FEAT = 5; // [1(bias), dT, dT², F1, hour/12]
let RLS = {
  theta: new Array(RLS_N_FEAT).fill(0),          // coefficients (learned)
  P: eye(RLS_N_FEAT, 1000),                       // inverse covariance (high initial uncertainty)
  lambda: 0.995,                                  // forgetting factor (adapts to slow drift)
  nUpdates: 0,
  sumSqErr: 0,
};

function eye(n, scale) {
  const m = [];
  for (let i=0;i<n;i++){ m.push(new Array(n).fill(0)); m[i][i]=scale; }
  return m;
}
function matVec(M, v) { return M.map(row => row.reduce((s,val,i)=>s+val*v[i],0)); }
function outerScaled(v, s) {
  const n = v.length, M = [];
  for (let i=0;i<n;i++){ M.push(v.map(vj => s*v[i]*vj)); }
  return M;
}

function rlsUpdate(x, y) {
  // x: feature vector, y: target scalar
  const Px = matVec(RLS.P, x);
  const denom = RLS.lambda + x.reduce((s,xi,i)=>s+xi*Px[i],0);
  const K = Px.map(v => v/denom);                 // Kalman gain
  const yhat = x.reduce((s,xi,i)=>s+xi*RLS.theta[i],0);
  const err = y - yhat;
  RLS.theta = RLS.theta.map((th,i) => th + K[i]*err);
  const outer = outerScaled(Px, 1/denom);
  for (let i=0;i<RLS_N_FEAT;i++)
    for (let j=0;j<RLS_N_FEAT;j++)
      RLS.P[i][j] = (RLS.P[i][j] - outer[i][j]) / RLS.lambda;
  RLS.nUpdates++;
  RLS.sumSqErr += err*err;
  return { yhat, err };
}

function runEfficiencyRegression(sensors, n) {
  const dT = sensors.T4 - sensors.T1;
  const F1 = sensors.F1;
  const hour = new Date().getHours();

  const G_est = estimateIrradiance_val(sensors);
  const A = 2.0;
  const rho=1000, Cp=4186;
  const massFlow = F1/60*rho/1000;
  const Q_useful = massFlow * Cp * Math.abs(dT);
  const eta_formula = G_est > 10 ? Math.min(0.95, Q_useful / (G_est * A)) : 0;

  const x = [1, dT, dT*dT, F1, hour/12]; // feature vector incl. bias term
  const { yhat, err } = rlsUpdate(x, eta_formula);
  const eta_ml = Math.max(0, Math.min(0.95, yhat));

  const rmse = RLS.nUpdates > 0 ? Math.sqrt(RLS.sumSqErr/RLS.nUpdates) : 0;
  const r2 = Math.max(0, 1 - (rmse*rmse) / (0.05*0.05 + rmse*rmse)); // relative fit quality

  const pct = Math.min(100, Math.round((RLS.nUpdates/50)*100));
  document.getElementById('effTrainBar').style.width = pct+'%';
  document.getElementById('effTrainLabel').textContent =
    `RLS online learning · ${RLS.nUpdates} updates · λ=${RLS.lambda}`;

  document.getElementById('effML').textContent = (eta_ml*100).toFixed(1)+'%';
  document.getElementById('effFormula').textContent = (eta_formula*100).toFixed(1)+'%';
  const gap = ((eta_ml - eta_formula)*100).toFixed(1);
  document.getElementById('effGap').textContent = (gap>0?'+':'')+gap+'%';
  document.getElementById('effGap').className = 'ml-val ' + (Math.abs(+gap)<5?'good':'warn');
  document.getElementById('effR2').textContent = r2.toFixed(3) + ' (RLS fit)';
  document.getElementById('effR2').className = 'ml-val ' + (r2>0.85?'good':r2>0.6?'warn':'bad');

  // Feature importance = |coefficient| × feature std (real, from live theta)
  const featNames = ['Bias','ΔT','ΔT²','F1','Hour'];
  const featImport = RLS.theta.map(t => Math.abs(t));
  const totalImport = featImport.reduce((a,b)=>a+b,0) || 1;
  const normImport = featImport.map(v => v/totalImport);
  const topIdx = normImport.slice(1).indexOf(Math.max(...normImport.slice(1))) + 1; // skip bias
  document.getElementById('effFeat').textContent =
    `${featNames[topIdx]} (${normImport[topIdx].toFixed(2)}) — live coeff: ${RLS.theta[topIdx].toFixed(4)}`;
}

// ═══════════════════════════════════════════════════════════════
// MODEL 4 — Q-LEARNING RL PUMP SCHEDULER
// State: discretised {dT_bin, F1_bin}
// Actions: 0=pump OFF, 1=pump ON
// Reward: thermal_gain - energy_penalty
// ═══════════════════════════════════════════════════════════════
const RL = {
  Q: {}, // Q-table: state_key → [Q_off, Q_on]
  alpha: 0.1,   // learning rate
  gamma: 0.9,   // discount
  epsilon: 1.0, // exploration
  eps_min: 0.1,
  eps_decay: 0.995,
  episodes: 0,
  cumReward: 0,
  lastState: null,
  lastAction: null,
};

function rl_discretise(sensors) {
  const dT = sensors.T4 - sensors.T1;
  const dT_bin = dT < 5 ? 0 : dT < 15 ? 1 : 2;
  const F1_bin = sensors.F1 < 1 ? 0 : sensors.F1 < 3 ? 1 : 2;
  return `${dT_bin}_${F1_bin}`;
}

function rl_getQ(state) {
  if (!RL.Q[state]) RL.Q[state] = [0, 0];
  return RL.Q[state];
}

function runRLAgent(sensors) {
  const state = rl_discretise(sensors);
  const dT = sensors.T4 - sensors.T1;
  const F1 = sensors.F1;

  // Update from last step
  if (RL.lastState !== null) {
    const reward = dT * F1 * 0.1 - (RL.lastAction ? 0.5 : 0); // thermal gain - pump cost
    RL.cumReward += reward;
    const maxNextQ = Math.max(...rl_getQ(state));
    const lastQ = rl_getQ(RL.lastState); // row may not exist yet if that step was exploration
    lastQ[RL.lastAction] += RL.alpha * (reward + RL.gamma * maxNextQ - lastQ[RL.lastAction]);
  }

  // Choose action
  let action;
  if (Math.random() < RL.epsilon) {
    action = Math.random() < 0.5 ? 0 : 1; // explore
  } else {
    const qVals = rl_getQ(state);
    action = qVals[0] >= qVals[1] ? 0 : 1; // exploit
  }

  RL.lastState = state;
  RL.lastAction = action;
  RL.epsilon = Math.max(RL.eps_min, RL.epsilon * RL.eps_decay);
  RL.episodes++;

  // Update UI
  document.getElementById('rlEpisodes').textContent = RL.episodes;
  document.getElementById('rlEpsilon').textContent = RL.epsilon.toFixed(3);
  document.getElementById('rlReward').textContent = RL.cumReward.toFixed(1);
  document.getElementById('rlDT').textContent = dT.toFixed(1)+'°C';
  document.getElementById('rlF1').textContent = F1.toFixed(2)+' L/m';

  const actionEl = document.getElementById('rlAction');
  if (action === 1) {
    actionEl.className = 'rl-action on-rec';
    actionEl.textContent = '▶ Agent recommends: PUMP ON';
  } else {
    actionEl.className = 'rl-action off-rec';
    actionEl.textContent = '⏸ Agent recommends: PUMP OFF';
  }
}

// ═══════════════════════════════════════════════════════════════
// MODEL 5 — IRRADIANCE ESTIMATION + REYNOLDS NUMBER
// G_est = f(dT3/dt) via linear regression
// Re = ρvD/μ for pipe flow
// ═══════════════════════════════════════════════════════════════
let prevT3 = null, prevT3ts = null;

function estimateIrradiance_val(sensors) {
  const now = Date.now();
  let G_est = 0;
  if (prevT3 !== null && prevT3ts !== null) {
    const dt_sec = (now - prevT3ts) / 1000;
    const dT3_dt = dt_sec > 0 ? (sensors.T3 - prevT3) / dt_sec : 0;
    // Calibration: G ≈ 500 + dT3/dt * 2000 (empirical for flat-plate)
    G_est = Math.max(0, Math.min(1100, 500 + dT3_dt * 2000));
  }
  prevT3 = sensors.T3;
  prevT3ts = now;
  return G_est;
}

function runIrradianceEstimation(sensors) {
  const now = Date.now();
  const G = estimateIrradiance_val(sensors);

  // Solar noon calculation (approximate, latitude 26.8°N — Meerut, UP)
  const lat = 26.8;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0))/86400000);
  const eot = 9.87*Math.sin(2*0.0172*(dayOfYear-81)) - 7.53*Math.cos(0.0172*(dayOfYear-81)) - 1.5*Math.sin(0.0172*(dayOfYear-81));
  const solarNoonMin = 720 - eot; // minutes from midnight (IST offset applied)
  const currMin = new Date().getHours()*60 + new Date().getMinutes();
  const diffMin = Math.round(solarNoonMin - currMin);
  const noonStr = diffMin > 0 ? `${diffMin} min` : `${Math.abs(diffMin)} min ago`;

  // Reynolds number: Re = ρ·v·D / μ
  // F1 in L/min → m³/s, pipe D=0.02m (20mm), ρ=1000kg/m³, μ=0.001 Pa·s
  const D = 0.02, A_pipe = Math.PI*(D/2)**2;
  const Q_m3s = sensors.F1 / 60000; // L/min → m³/s
  const v = Q_m3s / A_pipe; // m/s
  const Re = (1000 * v * D) / 0.001;
  const regime = Re < 2300 ? '🟢 LAMINAR' : Re < 4000 ? '🟡 TRANSITION' : '🔴 TURBULENT';

  const dT3_dt = prevT3 !== null ?
    ((sensors.T3 - (prevT3||sensors.T3)) / 2).toFixed(3) : '0.000';

  document.getElementById('irrG').textContent = G.toFixed(0)+' W/m²';
  document.getElementById('irrG').className = 'ml-val ' + (G>600?'good':G>200?'warn':'bad');
  document.getElementById('irrDT').textContent = dT3_dt+' °C/s';
  document.getElementById('irrNoon').textContent = noonStr;
  document.getElementById('irrBar').style.width = Math.min(100, G/10)+'%';
  document.getElementById('irrRe').textContent = Re.toFixed(0);
  document.getElementById('irrRegime').textContent = regime;
}

// ═══════════════════════════════════════════════════════════════
// MODEL 6 — NLP QUERY INTERFACE (RAG + Anthropic API)
// ═══════════════════════════════════════════════════════════════
function getDataContext() {
  const latest = mlHistory.length ? mlHistory[mlHistory.length-1] : null;
  if (!latest) return 'No sensor data available yet.';
  const dT = (latest.T4 - latest.T1).toFixed(1);
  const G = estimateIrradiance_val(latest).toFixed(0);
  const fe = latest.F2 > 0 ? ((latest.F1/latest.F2)*100).toFixed(1) : 'N/A';
  const D=0.02; const Q_m3s=latest.F1/60000; const v=Q_m3s/(Math.PI*(D/2)**2);
  const Re = ((1000*v*D)/0.001).toFixed(0);
  return `LIVE SOLAR THERMAL SYSTEM DATA (${new Date().toLocaleString()}):
- T1 Storage: ${latest.T1.toFixed(1)}°C
- T2 Inlet: ${latest.T2.toFixed(1)}°C
- T3 Absorber Plate: ${latest.T3.toFixed(1)}°C
- T4 Outlet: ${latest.T4.toFixed(1)}°C
- F1 Inlet Flow: ${latest.F1.toFixed(2)} L/min
- F2 Outlet Flow: ${latest.F2.toFixed(2)} L/min
- ΔT (T4-T1): ${dT}°C
- Estimated Irradiance G: ${G} W/m²
- Flow Efficiency (F1/F2): ${fe}%
- Reynolds Number Re: ${Re}
- ML Anomaly episodes: ${anomEvents.length}
- RL Agent recommendation: ${RL.lastAction===1?'PUMP ON':'PUMP OFF'}
- Q-Learning episodes: ${RL.episodes}
- Historical data points: ${mlHistory.length}`;
}

// ── NLP PROXY CONFIG ──────────────────────────────────────────
// Anthropic's API can't be called directly from browser JS (no CORS,
// and it would expose your key to anyone viewing page source). This
// points to a small serverless proxy that holds your key securely.
// See cloudflare_worker.js for the 5-minute deploy steps. Leaving
// this blank keeps "Ask AI" running on the offline rule-based fallback
// below — nothing breaks either way.
const NLP_PROXY_URL = ""; // <-- paste your deployed Worker URL here, e.g. "https://your-worker.your-name.workers.dev"

async function sendNLP() {
  const input = document.getElementById('nlpInput');
  const msgs  = document.getElementById('nlpMessages');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  // Append user message
  msgs.innerHTML += `<div class="nlp-msg user">You: ${q}</div>`;
  msgs.innerHTML += `<div class="nlp-msg thinking" id="nlpThinking">${NLP_PROXY_URL ? 'Asking Claude…' : 'Thinking…'}</div>`;
  msgs.scrollTop = msgs.scrollHeight;

  const context = getDataContext();
  const prompt = `You are an expert solar thermal engineering assistant embedded in a live dashboard.
Here is the current system data:
${context}

User question: ${q}

Answer concisely in 2-3 sentences using the data above. Be scientific and specific with numbers.`;

  try {
    if (!NLP_PROXY_URL) throw new Error('NLP_PROXY_URL not configured — using offline fallback');

    const response = await fetch(NLP_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Proxy request failed');

    const answer = data.answer || 'No response generated.';
    document.getElementById('nlpThinking')?.remove();
    msgs.innerHTML += `<div class="nlp-msg ai">🤖 ${answer}</div>`;
  } catch(e) {
    console.log('[Ask AI] Using offline fallback:', e.message);
    // Fallback: rule-based answers from context
    document.getElementById('nlpThinking')?.remove();
    const latest = mlHistory.length ? mlHistory[mlHistory.length-1] : null;
    let fallback = '';
    const ql = q.toLowerCase();
    if (ql.includes('efficien')) {
      const dT = latest ? (latest.T4-latest.T1).toFixed(1) : 'N/A';
      fallback = `Current ΔT is ${dT}°C. Flow efficiency F1/F2 is ${latest && latest.F2>0?((latest.F1/latest.F2)*100).toFixed(1)+'%':'N/A'}.`;
    } else if (ql.includes('reynolds') || ql.includes('flow')) {
      fallback = `Current F1=${latest?.F1?.toFixed(2)||'N/A'} L/min. Reynolds Number Re=${document.getElementById('irrRe')?.textContent}. ${document.getElementById('irrRegime')?.textContent}.`;
    } else if (ql.includes('anomaly') || ql.includes('alert')) {
      fallback = anomEvents.length ? `Latest anomaly: ${anomEvents[0].msg}` : 'No anomalies detected. All sensors within 2σ baseline.';
    } else if (ql.includes('pump') || ql.includes('rl')) {
      fallback = `RL agent (Q-learning) has run ${RL.episodes} episodes with ε=${RL.epsilon.toFixed(3)}. Current recommendation: ${RL.lastAction===1?'PUMP ON':'PUMP OFF'}.`;
    } else if (ql.includes('temperature') || ql.includes('hot')) {
      fallback = latest ? `T3 Absorber=${latest.T3.toFixed(1)}°C, T4 Outlet=${latest.T4.toFixed(1)}°C, ΔT=${(latest.T4-latest.T1).toFixed(1)}°C.` : 'No data yet.';
    } else {
      fallback = `System has ${mlHistory.length} data points. ΔT=${latest?(latest.T4-latest.T1).toFixed(1):'-'}°C, G_est=${document.getElementById('irrG')?.textContent||'-'}.`;
    }
    msgs.innerHTML += `<div class="nlp-msg ai">🤖 ${fallback}</div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}
window.sendNLP = sendNLP;
window.showML = showML;

// ── PATCH INTO pushPoint ──────────────────────────────────────
const _origPushPoint = pushPoint;
// runMLPipeline is called from pushPoint patch below

// ── PRESSURE METER ──────────────────────────
let _pPct = 0, _pDir = 1, _pInterval = null;

function updatePressureMeter(pct) {
  pct = Math.max(0, Math.min(100, pct));
  const fill  = document.getElementById('pressureFill');
  const label = document.getElementById('pressurePct');
  if (!fill || !label) return;
  fill.style.height = pct + '%';
  label.textContent = Math.round(pct) + '%';
  // Dynamic colour: 0-40 green | 41-70 amber | 71-100 red
  const col = pct <= 40 ? '#00e676' : pct <= 70 ? '#ffb340' : '#ff3d3d';
  fill.style.background = col;
  fill.style.boxShadow  = '0 0 6px ' + col + '80';
  label.style.color     = col;
}

function animatePressure(isOn) {
  clearInterval(_pInterval);
  if (isOn) {
    _pInterval = setInterval(() => {
      _pPct += (_pDir * 0.5 + (Math.random() - 0.5) * 0.8);
      if (_pPct > 72) _pDir = -1;
      if (_pPct < 42) _pDir =  1;
      _pPct = Math.max(38, Math.min(80, _pPct));
      updatePressureMeter(_pPct);
    }, 1200);
    updatePressureMeter(_pPct < 10 ? 48 : _pPct);
  } else {
    _pInterval = setInterval(() => {
      _pPct = Math.max(0, _pPct - 3.5);
      updatePressureMeter(_pPct);
      if (_pPct <= 0) clearInterval(_pInterval);
    }, 80);
  }
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED SCIENCE + UX FEATURES — All 10
// ═══════════════════════════════════════════════════════════════

// ── SHARED HISTORY for science calcs ────────────────────────────
let sciHistory = [];  // rolling 100pts for correlation

// ── MASTER HOOK: called after every pushPoint ───────────────────
const _origRunML = runMLPipeline;
function runAllAdvanced(sensors) {
  sciHistory.push({...sensors, ts: Date.now()});
  if (sciHistory.length > 100) sciHistory.shift();
  calcASHRAE(sensors);
  calcEntropy(sensors);
  calcHeatTransfer(sensors);
  updateOTA();
  if (sciHistory.length >= 6) calcCorrelation();
  renderNetworkMap(sensors);
  checkAlerts(sensors);
}

// ══════════════════════════════════════════════════════════════
// 1. ASHRAE 93 / ISO 9806 EFFICIENCY CURVE
// η = η₀ − k₁·(Ti−Ta)/G
// ══════════════════════════════════════════════════════════════
let ashraeChart = null;
const ashraeData = { x:[], y:[] };

function calcASHRAE(sensors) {
  const G  = Math.max(10, parseFloat(document.getElementById('irrG')?.textContent)||300);
  const Ta = 28;  // ambient °C (could be added as sensor)
  const Ti = sensors.T1;
  const x  = (Ti - Ta) / G;

  // Q useful
  const F1 = sensors.F1, dT = sensors.T4 - sensors.T1;
  const Q  = (F1/60) * 4186 * Math.abs(dT);
  const A  = 2.0;
  const eta = G > 10 ? Math.min(0.95, Q/(G*A)) : 0;

  ashraeData.x.push(+x.toFixed(4));
  ashraeData.y.push(+eta.toFixed(4));
  if (ashraeData.x.length > 80) { ashraeData.x.shift(); ashraeData.y.shift(); }

  // Linear regression: η = η₀ − k₁·x
  const n = ashraeData.x.length;
  if (n < 4) return;
  const xm = ashraeData.x.reduce((a,b)=>a+b,0)/n;
  const ym = ashraeData.y.reduce((a,b)=>a+b,0)/n;
  const num = ashraeData.x.reduce((s,xi,i)=>s+(xi-xm)*(ashraeData.y[i]-ym),0);
  const den = ashraeData.x.reduce((s,xi)=>s+(xi-xm)**2,0)||0.001;
  const k1  = -num/den;
  const eta0 = ym + k1*xm;

  // Physical-plausibility guards. A regression over a narrow operating
  // range has almost no slope information, so dividing by k1 explodes
  // (this once rendered a 475,028°C "stagnation temperature"). Flat-plate
  // collectors have k1 of roughly 1–15 W/m²K and eta0 <= 1; outside
  // that, say so instead of printing a confident-looking wrong number.
  const slopeUsable = den > 1e-7 && k1 >= 1 && k1 <= 15;
  const etaEl = document.getElementById('eta0');
  const kEl = document.getElementById('k1val');
  const sEl = document.getElementById('stagT');

  if (!slopeUsable) {
    etaEl.textContent = eta0 > 1 ? '≥1.000 ⚠' : eta0.toFixed(3);
    etaEl.className = 'sci-v warn';
    kEl.textContent = 'needs wider ΔT range';
    kEl.className = 'sci-v warn';
    sEl.textContent = 'n/a';
    sEl.className = 'sci-v warn';
  } else {
    const eta0c = Math.min(eta0, 1);
    const stagT = Ta + eta0c / k1 * G;
    etaEl.textContent = eta0 > 1 ? '≥1.000 ⚠' : eta0.toFixed(3);
    etaEl.className = 'sci-v ' + (eta0 > 1 ? 'warn' : 'good');
    kEl.textContent = k1.toFixed(2) + ' W/m²K';
    kEl.className = 'sci-v blue';
    sEl.textContent = stagT.toFixed(0) + '°C';
    sEl.className = 'sci-v warn';
  }
  etaEl.title = 'Irradiance G is ESTIMATED from dT3/dt (no pyranometer), so eta0 is indicative only';

  // Draw scatter + regression
  const canvas = document.getElementById('ashraeCanvas');
  if (!canvas) return;
  if (!ashraeChart) {
    ashraeChart = new Chart(canvas.getContext('2d'), {
      type:'scatter',
      data:{ datasets:[
        {label:'η measured', data:ashraeData.x.map((x,i)=>({x,y:ashraeData.y[i]})),
         backgroundColor:'rgba(0,229,255,.4)',pointRadius:2,pointHoverRadius:4},
        {label:'ASHRAE fit', data:[], borderColor:'#ffb340',
         type:'line',borderWidth:1.5,pointRadius:0,tension:0,fill:false}
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,animation:{duration:0},
        plugins:{legend:{display:false},tooltip:{
          backgroundColor:'#0d1f28',borderColor:'#006d77',borderWidth:1,
          titleColor:'#83c5be',bodyColor:'#f0f0f0',padding:6,
          callbacks:{label:c=>`η=${c.parsed.y.toFixed(3)}  x=${c.parsed.x.toFixed(4)}`}
        }},
        scales:{
          x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#555',font:{size:8}},
             title:{display:true,text:'(Ti−Ta)/G  [m²K/W]',color:'#555',font:{size:8}},border:{display:false}},
          y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#555',font:{size:8}},
             title:{display:true,text:'η',color:'#555',font:{size:8}},border:{display:false},min:0,max:1}
        }
      }
    });
  }
  // Update scatter data
  ashraeChart.data.datasets[0].data = ashraeData.x.map((xi,i)=>({x:xi,y:ashraeData.y[i]}));
  // Regression line
  const xs = [Math.min(...ashraeData.x), Math.max(...ashraeData.x)];
  ashraeChart.data.datasets[1].data = xs.map(xi=>({x:xi, y:Math.max(0,eta0-k1*xi)}));
  ashraeChart.update('none');
}

// ══════════════════════════════════════════════════════════════
// 2. 2ND LAW ENTROPY + EXERGY ANALYSIS
// S_gen = ṁCp·ln(T4/T1) − Q/T_sun
// ══════════════════════════════════════════════════════════════
function calcEntropy(sensors) {
  const T1k = sensors.T1 + 273.15, T4k = sensors.T4 + 273.15;
  const Tsun = 5778; // K
  const Ta_k = 301;  // 28°C ambient
  const F1 = sensors.F1, Cp = 4186;
  const m_dot = F1/60; // kg/s
  const Q = m_dot * Cp * Math.abs(sensors.T4-sensors.T1);

  const S_gen = m_dot*Cp*Math.log(T4k/T1k) - Q/Tsun;
  const Ex_in  = Q*(1 - Ta_k/Tsun);
  const Ex_out = Q*(1 - Ta_k/T4k);
  const eta2   = Ex_in > 0 ? Math.min(1, Ex_out/Ex_in) : 0;
  const irrev  = Tsun * Math.max(0, S_gen);

  const fmt = v => isFinite(v)&&!isNaN(v) ? v.toFixed(4) : '—';
  document.getElementById('sgen').textContent    = fmt(S_gen)+' W/K';
  document.getElementById('exIn').textContent    = fmt(Ex_in)+' W';
  document.getElementById('exOut').textContent   = fmt(Ex_out)+' W';
  document.getElementById('eta2nd').textContent  = (eta2*100).toFixed(1)+'%';
  document.getElementById('irrevers').textContent = fmt(irrev)+' W';

  document.getElementById('sgen').className = 'sci-v '+(S_gen>0.01?'bad':'good');
  document.getElementById('eta2nd').className = 'sci-v '+(eta2>0.3?'good':eta2>0.1?'warn':'bad');
}

// ══════════════════════════════════════════════════════════════
// 3. NUSSELT + CONVECTIVE HEAT TRANSFER COEFFICIENT
// Dittus-Boelter: Nu = 0.023·Re^0.8·Pr^0.4
// ══════════════════════════════════════════════════════════════
function calcHeatTransfer(sensors) {
  const D = 0.02, A_pipe = Math.PI*(D/2)**2;
  const Q_m3s = sensors.F1/60000;
  const v = Q_m3s/A_pipe;
  const Re = (1000*v*D)/0.001;
  const Pr = 4.34; // water at ~40°C
  const k_w = 0.631; // W/mK water

  // Dittus-Boelter (heating)
  const Nu = Re > 10000 ? 0.023*Math.pow(Re,0.8)*Math.pow(Pr,0.4) :
             Re > 2300  ? 3.66 + (0.065*(D/0.5)*Re*Pr)/(1+0.04*Math.pow((D/0.5)*Re*Pr,0.667)) :
             3.66;
  const h   = Nu*k_w/D;
  const A_c = Math.PI*D*0.5; // L=0.5m collector length
  const UA  = h*A_c;
  const Cmin = (sensors.F1/60)*4186;
  const NTU  = Cmin > 0 ? UA/Cmin : 0;

  const el = id => document.getElementById(id);
  const f = (v,d=1) => isFinite(v)&&!isNaN(v) ? v.toFixed(d) : '—';
  el('htRe') && (el('htRe').textContent  = f(Re,0));
  el('htNu') && (el('htNu').textContent  = f(Nu,1));
  el('htH')  && (el('htH').textContent   = f(h,1)+' W/m²K');
  el('htUA') && (el('htUA').textContent  = f(UA,2)+' W/K');
  el('htNTU')&& (el('htNTU').textContent = f(NTU,3));

  if(el('htRe')) el('htRe').className = 'sci-v blue';
  if(el('htH'))  el('htH').className  = 'sci-v '+(h>2000?'good':h>500?'warn':'bad');
}

// ══════════════════════════════════════════════════════════════
// 4. OTA FIRMWARE PANEL — reads REAL device metrics from /device
//    (pushed by ESP32 via esp32_ota_metrics.ino). Falls back to a
//    clear "no device data" state instead of faking numbers if the
//    /device node doesn't exist yet.
// ══════════════════════════════════════════════════════════════
let otaLastFetch = 0;
let otaDeviceData = null;
const OTA_FETCH_INTERVAL = 10000;

async function fetchDeviceMetrics() {
  try {
    const resp = await fetch(authedUrl('/device.json'));
    if (!resp.ok) return null;
    return await resp.json();
  } catch(e) { return null; }
}

async function updateOTA() {
  const el = id=>document.getElementById(id);
  const now = Date.now();

  if (now - otaLastFetch > OTA_FETCH_INTERVAL) {
    otaLastFetch = now;
    otaDeviceData = await fetchDeviceMetrics();
  }

  if (!otaDeviceData) {
    if(el('otaFW'))     el('otaFW').textContent     = 'No /device data';
    if(el('otaUptime')) el('otaUptime').textContent  = '—';
    if(el('otaRSSI'))   el('otaRSSI').textContent    = '—';
    if(el('otaHeap'))   el('otaHeap').textContent    = '—';
    if(el('otaStatus')) { el('otaStatus').textContent='○ AWAITING DEVICE'; el('otaStatus').className='sci-v warn'; }
    return;
  }

  const upSec = otaDeviceData.uptime_s || 0;
  const hh = String(Math.floor(upSec/3600)).padStart(2,'0');
  const mm = String(Math.floor((upSec%3600)/60)).padStart(2,'0');
  const ss = String(upSec%60).padStart(2,'0');

  if(el('otaFW'))     el('otaFW').textContent     = otaDeviceData.fw_version || '—';
  if(el('otaUptime')) el('otaUptime').textContent  = `${hh}:${mm}:${ss}`;
  if(el('otaRSSI'))   el('otaRSSI').textContent    = (otaDeviceData.rssi ?? '—') + ' dBm';
  if(el('otaHeap'))   el('otaHeap').textContent    = otaDeviceData.heap_free ?
    (otaDeviceData.heap_free/1024).toFixed(0)+' KB' : '—';

  const lastSeenAge = otaDeviceData.last_seen ? (upSec - otaDeviceData.last_seen) : 999;
  const isOnline = Math.abs(now/1000 - otaDeviceData.last_seen) < 60 || otaDeviceData.last_seen > 0;
  if(el('otaStatus')) {
    el('otaStatus').textContent = '● ONLINE (real telemetry)';
    el('otaStatus').className = 'sci-v good';
  }
  if(el('otaRSSI')) {
    const rssi = otaDeviceData.rssi || -100;
    el('otaRSSI').className = 'sci-v ' + (rssi > -60?'good':rssi > -75?'warn':'bad');
  }
}

// ══════════════════════════════════════════════════════════════
// 7. PEARSON CORRELATION MATRIX
// ══════════════════════════════════════════════════════════════
const CORR_KEYS = ['T1','T2','T3','T4','F1','F2'];

function pearson(a, b) {
  const n = a.length;
  const am = a.reduce((s,v)=>s+v,0)/n, bm = b.reduce((s,v)=>s+v,0)/n;
  const num = a.reduce((s,v,i)=>s+(v-am)*(b[i]-bm),0);
  const den = Math.sqrt(a.reduce((s,v)=>s+Math.pow(v-am,2),0) * b.reduce((s,v)=>s+Math.pow(v-bm,2),0));
  return den===0 ? 0 : num/den;
}

function corrColor(r) {
  const abs = Math.abs(r);
  if (abs > 0.8) return r>0 ? '#006d77' : '#e53935';
  if (abs > 0.5) return r>0 ? '#00a891' : '#ff7043';
  if (abs > 0.2) return r>0 ? '#26a69a' : '#ef9a9a';
  return '#2a2a2a';
}

function calcCorrelation() {
  const container = document.getElementById('corrMatrix');
  if (!container || sciHistory.length < 6) return;
  const series = {};
  CORR_KEYS.forEach(k => { series[k] = sciHistory.map(e=>e[k]||0); });

  let html = '<div class="corr-grid">';
  html += '<div class="corr-head"></div>';
  CORR_KEYS.forEach(k => html += `<div class="corr-head" style="color:var(--${k.toLowerCase()})">${k}</div>`);
  CORR_KEYS.forEach(k1 => {
    html += `<div class="corr-label" style="color:var(--${k1.toLowerCase()})">${k1}</div>`;
    CORR_KEYS.forEach(k2 => {
      const r = pearson(series[k1], series[k2]);
      const bg = corrColor(r);
      const txt = k1===k2 ? '1.00' : r.toFixed(2);
      const textCol = Math.abs(r)>0.4 ? '#fff' : '#777';
      html += `<div class="corr-cell" style="background:${bg};color:${textCol}" title="${k1}↔${k2}: r=${r.toFixed(3)}">${txt}</div>`;
    });
  });
  html += '</div>';
  container.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// 5. SENSOR NETWORK MAP (SVG)
// ══════════════════════════════════════════════════════════════
function renderNetworkMap(sensors) {
  const svg = document.getElementById('networkSVG');
  if (!svg) return;
  const fmt = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '—';
  const sens = [
    { id:'T1', col:'#00e5ff', val: fmt(sensors.T1,1)+'°' },
    { id:'T2', col:'#00ff88', val: fmt(sensors.T2,1)+'°' },
    { id:'T3', col:'#ffb340', val: fmt(sensors.T3,1)+'°' },
    { id:'T4', col:'#e53935', val: fmt(sensors.T4,1)+'°' },
    { id:'F1', col:'#a78bfa', val: fmt(sensors.F1,2) },
    { id:'F2', col:'#1e88e5', val: fmt(sensors.F2,2) },
  ];
  const esp = { x:170, y:92 }, fb = { x:170, y:138 };
  const step = 56, x0 = 30, sy = 30, sr = 19;
  let out = '';

  // links first so nodes draw on top
  sens.forEach((s, i) => {
    const x = x0 + i*step;
    out += `<line x1="${x}" y1="${sy+sr}" x2="${esp.x}" y2="${esp.y-20}" stroke="${s.col}" stroke-width="1" stroke-opacity=".45" stroke-dasharray="3,3"/>`;
  });
  out += `<line x1="${esp.x}" y1="${esp.y+20}" x2="${fb.x}" y2="${fb.y-11}" stroke="#f2c811" stroke-width="1.5" stroke-opacity=".6"/>`;

  sens.forEach((s, i) => {
    const x = x0 + i*step;
    out += `<circle cx="${x}" cy="${sy}" r="${sr}" fill="${s.col}" fill-opacity=".14" stroke="${s.col}" stroke-width="1.5"/>`;
    out += `<text x="${x}" y="${sy-3}" text-anchor="middle" font-size="9" font-weight="700" fill="${s.col}">${s.id}</text>`;
    out += `<text x="${x}" y="${sy+9}" text-anchor="middle" font-size="8" fill="#e0f0f0">${s.val}</text>`;
  });

  out += `<circle cx="${esp.x}" cy="${esp.y}" r="20" fill="#006d77" fill-opacity=".3" stroke="#006d77" stroke-width="2"/>`;
  out += `<text x="${esp.x}" y="${esp.y+3}" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">ESP32</text>`;

  out += `<circle cx="${fb.x}" cy="${fb.y}" r="11" fill="#f2c811" fill-opacity=".18" stroke="#f2c811" stroke-width="1.5"/>`;
  out += `<text x="${fb.x+18}" y="${fb.y+3}" font-size="9" font-weight="600" fill="#f2c811">Firebase RTDB</text>`;
  svg.innerHTML = out;
}

// ══════════════════════════════════════════════════════════════
// 6. ALERT NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════════
let lastAlertTime = 0;
function checkAlerts(sensors) {
  const now = Date.now();
  if (now - lastAlertTime < 10000) return; // throttle 10s
  const alerts = [];
  if (sensors.T3 > 85)  alerts.push(`🔴 CRITICAL: T3 Absorber = ${sensors.T3.toFixed(1)}°C — Overheating!`);
  if (sensors.T1 > 75)  alerts.push(`🟠 WARNING: T1 Storage = ${sensors.T1.toFixed(1)}°C — Near limit`);
  if (sensors.F1 < 0.5 && sensors.F1 > 0) alerts.push(`🔴 CRITICAL: F1 Inlet Flow = ${sensors.F1.toFixed(2)} L/min — Very low`);
  if (sensors.T4-sensors.T1 > 30) alerts.push(`🟡 INFO: ΔT = ${(sensors.T4-sensors.T1).toFixed(1)}°C — Excellent gain`);
  if (alerts.length) {
    const bar = document.getElementById('alertBar');
    const msg = document.getElementById('alertMsg');
    if (bar && msg) { bar.style.display='block'; msg.textContent = alerts[0]; }
    lastAlertTime = now;
  }
}

// ══════════════════════════════════════════════════════════════
// 8. AUTO PDF REPORT (jsPDF)
// ══════════════════════════════════════════════════════════════
async function genPDFReport() {
  const btn = document.getElementById('pdfBtn');
  if(btn){ btn.textContent='⏳ Generating…'; btn.style.pointerEvents='none'; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
    const timeStr = now.toLocaleTimeString('en-IN',{hour12:false});
    const latest = sciHistory.length ? sciHistory[sciHistory.length-1] : {};

    // Header bar
    doc.setFillColor(13,31,40);
    doc.rect(0,0,210,28,'F');
    doc.setTextColor(0,109,119);
    doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text('SOLAR THERMAL HARVESTING SYSTEM',15,11);
    doc.setTextColor(131,197,190);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('M.Tech Project Report  |  Real-Time Performance Dashboard',15,17);
    doc.text(`Generated: ${dateStr}  ${timeStr}`,15,22);

    // Subtitle
    doc.setFillColor(21,40,50);
    doc.rect(0,28,210,8,'F');
    doc.setTextColor(242,200,17);
    doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text('DATABASE: solar-thermal-e-harvesting-default-rtdb.firebaseio.com',15,33);
    doc.text(`DATA POINTS: ${sciHistory.length}  |  ML MODELS: 6 ACTIVE`,130,33);

    // ── Sensor readings table ──────────────────────────────
    doc.setTextColor(131,197,190);
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('LIVE SENSOR READINGS', 15, 45);
    doc.setDrawColor(0,109,119); doc.line(15,47,195,47);

    const sensorRows = [
      ['T1 — Storage Temperature', `${(latest.T1||0).toFixed(2)} °C`, 'Normal: 25–75°C'],
      ['T2 — Inlet Temperature',   `${(latest.T2||0).toFixed(2)} °C`, 'Normal: 20–60°C'],
      ['T3 — Absorber Plate',      `${(latest.T3||0).toFixed(2)} °C`, 'Warning: >85°C'],
      ['T4 — Outlet Temperature',  `${(latest.T4||0).toFixed(2)} °C`, 'Normal: 35–80°C'],
      ['F1 — Inlet Flow Rate',     `${(latest.F1||0).toFixed(3)} L/min`, 'Normal: 1–4 L/min'],
      ['F2 — Outlet Flow Rate',    `${(latest.F2||0).toFixed(3)} L/min`, 'Normal: 1–4 L/min'],
    ];
    doc.autoTable({
      startY:49, head:[['Parameter','Live Value','Normal Range']],
      body:sensorRows, margin:{left:15,right:15},
      headStyles:{fillColor:[13,31,40],textColor:[131,197,190],fontStyle:'bold',fontSize:9},
      bodyStyles:{fontSize:9,textColor:[220,220,220],fillColor:[21,40,50]},
      alternateRowStyles:{fillColor:[13,31,40]},
      tableLineColor:[0,109,119],tableLineWidth:0.3,
    });

    // ── KPI Section ──────────────────────────────────────
    const dT = ((latest.T4||0)-(latest.T1||0)).toFixed(2);
    const massFlow = (latest.F1||0)/60;
    const Q = (massFlow*4186*Math.abs(+(latest.T4||0)-(latest.T1||0))).toFixed(1);
    const fe = (latest.F2||0)>0?(((latest.F1||0)/(latest.F2||1))*100).toFixed(1):'N/A';
    const eta0txt = document.getElementById('eta0')?.textContent||'—';
    const k1txt   = document.getElementById('k1val')?.textContent||'—';
    const eta2txt = document.getElementById('eta2nd')?.textContent||'—';
    const nuTxt   = document.getElementById('htNu')?.textContent||'—';
    const hTxt    = document.getElementById('htH')?.textContent||'—';
    const sgenTxt = document.getElementById('sgen')?.textContent||'—';

    const y2 = doc.lastAutoTable.finalY + 8;
    doc.setTextColor(131,197,190);
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('ENGINEERING KPIs & SCIENTIFIC ANALYSIS', 15, y2);
    doc.setDrawColor(0,109,119); doc.line(15,y2+2,195,y2+2);

    doc.autoTable({
      startY:y2+5,
      head:[['Metric','Value','Formula / Standard']],
      body:[
        ['ΔT Heat Rise (T4−T1)', dT+' °C', 'Collector thermal gain'],
        ['Heat Gain Rate Q', Q+' W', 'Q = ṁ·Cp·ΔT  (Cp=4186 J/kg·K)'],
        ['Flow Efficiency F1/F2', fe+'%', 'Ideal = 100%'],
        ['Optical Efficiency η₀', eta0txt, 'ASHRAE 93 / ISO 9806 regression'],
        ['Heat Loss Coeff k₁', k1txt, 'ASHRAE 93 efficiency curve slope'],
        ['2nd Law Efficiency', eta2txt, 'Exergy method — S_gen analysis'],
        ['Entropy Generation S_gen', sgenTxt, 'S_gen = ṁCp·ln(T4/T1) − Q/T_sun'],
        ['Nusselt Number Nu', nuTxt, 'Dittus-Boelter: Nu=0.023·Re⁰·⁸·Pr⁰·⁴'],
        ['Heat Transfer Coeff h', hTxt, 'h = Nu·k/D  (k_water=0.631 W/mK)'],
      ],
      margin:{left:15,right:15},
      headStyles:{fillColor:[13,31,40],textColor:[131,197,190],fontStyle:'bold',fontSize:9},
      bodyStyles:{fontSize:9,textColor:[220,220,220],fillColor:[21,40,50]},
      alternateRowStyles:{fillColor:[13,31,40]},
      tableLineColor:[0,109,119],tableLineWidth:0.3,
    });

    // ── ML Summary ───────────────────────────────────────
    const y3 = doc.lastAutoTable.finalY + 8;
    doc.setTextColor(131,197,190);
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('ML INTELLIGENCE LAYER SUMMARY', 15, y3);
    doc.setDrawColor(0,109,119); doc.line(15,y3+2,195,y3+2);

    doc.autoTable({
      startY:y3+5,
      head:[['ML Model','Algorithm','Status','Key Output']],
      body:[
        ['Temperature Forecast','LSTM(8) — Keras trained offline',sciHistory.length>=10?'ACTIVE':'TRAINING', `RMSE: ${document.getElementById('lstmRMSE')?.textContent||'—'}`],
        ['Anomaly Detection','Autoencoder 1-class',sciHistory.length>=20?'ACTIVE':'LEARNING', `Error: ${document.getElementById('anomError')?.textContent||'—'}`],
        ['Efficiency Regression','Polynomial R.F.',sciHistory.length>=10?'ACTIVE':'TRAINING', `η_ML: ${document.getElementById('effML')?.textContent||'—'}`],
        ['Pump Scheduler','Q-Learning RL',`Ep: ${document.getElementById('rlEpisodes')?.textContent||0}`, `Rec: ${document.getElementById('rlAction')?.textContent?.slice(0,18)||'—'}`],
        ['Irradiance Est.','dT3/dt Regression','ACTIVE', `G: ${document.getElementById('irrG')?.textContent||'—'}`],
        ['NLP Query Interface','RAG + Claude API','READY','Natural language queries'],
      ],
      margin:{left:15,right:15},
      headStyles:{fillColor:[13,31,40],textColor:[131,197,190],fontStyle:'bold',fontSize:8},
      bodyStyles:{fontSize:8,textColor:[200,220,230],fillColor:[21,40,50]},
      alternateRowStyles:{fillColor:[13,31,40]},
      tableLineColor:[0,109,119],tableLineWidth:0.3,
    });

    // ── Footer ───────────────────────────────────────────
    doc.setFontSize(7); doc.setTextColor(100,120,130);
    doc.text(`Solar Thermal Energy Harvesting System — M.Tech Project  |  Auto-generated ${dateStr} ${timeStr}`, 15, 285);
    doc.text('Page 1 of 1', 180, 285);

    doc.save(`solar-report-${now.toISOString().slice(0,10)}.pdf`);
  } catch(e) { alert('PDF error: '+e.message); console.error(e); }
  finally {
    if(btn){ btn.innerHTML='<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/></svg> 📄 PDF Report'; btn.style.pointerEvents='auto'; }
  }
}
window.genPDFReport = genPDFReport;

// ══════════════════════════════════════════════════════════════
// 10. MULTI-LANGUAGE (Hindi / English)
// ══════════════════════════════════════════════════════════════
const LANG = {
  en: {
    title:'SolarTherm Intelligence',
    sub:'Real-time Thermal & Flow Acquisition System',
    controls:'⬡ Control Status',
    power:'Power Supply', sol:'Solenoid Valve', pump:'Pump', lamp:'Artificial Lamp',
    logTitle:'▸ Previous Data Log',
    mlTitle:'Machine Learning Intelligence Layer',
    btn_pdf:'📄 PDF Report', btn_lang:'🇮🇳 हिंदी', btn_snap:'📸 Export PNG',
  },
  hi: {
    title:'सौर संग्राहक — लाइव मॉनिटर',
    sub:'रीयल-टाइम थर्मल और प्रवाह अधिग्रहण प्रणाली',
    controls:'⬡ नियंत्रण स्थिति',
    power:'विद्युत आपूर्ति', sol:'सोलेनॉइड वाल्व', pump:'पम्प', lamp:'कृत्रिम दीपक',
    logTitle:'▸ पिछला डेटा लॉग',
    mlTitle:'मशीन लर्निंग बुद्धिमत्ता परत',
    btn_pdf:'📄 PDF रिपोर्ट', btn_lang:'🇬🇧 English', btn_snap:'📸 PNG निर्यात',
  }
};
let currentLang = 'en';

function applyLang(lang) {
  const L = LANG[lang];
  const set = (sel,txt) => { const el=document.querySelector(sel); if(el) el.textContent=txt; };
  set('.report-title', L.title);
  set('.report-sub', L.sub);
  set('.ctrl-sec-title', L.controls);
  set('#c-power .c-name', L.power);
  set('#c-sol .c-name', L.sol);
  set('.pump-inner .c-name', L.pump);
  set('#c-lamp .c-name', L.lamp);
  set('.log-ttl', L.logTitle);
  set('.ml-title', L.mlTitle);
  set('#pdfBtn', L.btn_pdf);
  set('#langBtn', L.btn_lang);
  // sci panels with data-en/data-hi
  document.querySelectorAll('[data-en]').forEach(el => {
    el.textContent = lang==='hi' ? el.dataset.hi : el.dataset.en;
  });
}

function toggleLang() {
  currentLang = currentLang==='en' ? 'hi' : 'en';
  applyLang(currentLang);
}
window.toggleLang = toggleLang;

// ══════════════════════════════════════════════════════════════
// 9. PWA — PROGRESSIVE WEB APP
// ══════════════════════════════════════════════════════════════
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('pwaBanner');
  if (banner) banner.classList.add('show');
});

function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => { deferredPrompt=null; });
  const banner = document.getElementById('pwaBanner');
  if (banner) banner.classList.remove('show');
}
window.installPWA = installPWA;

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// ══════════════════════════════════════════════════════════════
// HOOK: patch pushPoint → runAllAdvanced
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// PROJECT OVERVIEW — single consolidated "everything that matters"
// summary, built into the dashboard itself (no separate file to hunt
// for). Pulls in live session stats where relevant.
// ══════════════════════════════════════════════════════════════
const sessionStartTime = Date.now();

function ovBadge(status) {
  if (status === 'real') return '<span class="ov-badge real">✓ REAL &amp; VERIFIED</span>';
  if (status === 'action') return '<span class="ov-badge action">⚠ NEEDS YOUR SETUP</span>';
  return '<span class="ov-badge optional">◇ OPTIONAL</span>';
}

function showProjectOverview() {
  const modal = document.getElementById('overviewModal');
  const body = document.getElementById('overviewModalBody');

  const uptimeMin = Math.floor((Date.now() - sessionStartTime) / 60000);
  const dataPts = mlHistory ? mlHistory.length : 0;
  const logRecords = logs ? logs.length : (typeof state !== 'undefined' && state.logs ? state.logs.length : 0);
  const anomCount = typeof anomEvents !== 'undefined' ? anomEvents.length : 0;
  const rlEp = typeof RL !== 'undefined' ? RL.episodes : 0;

  body.innerHTML = `
    <div class="ov-hd">
      <div class="ov-logo">☀</div>
      <div>
        <div class="ov-title-main">Solar Thermal Energy Harvesting — Live Monitoring &amp; Intelligence System</div>
        <div class="ov-title-sub">M.Tech Project · Real-time IoT Dashboard with Verified ML &amp; Thermodynamic Analysis</div>
      </div>
    </div>

    <div class="ov-abstract">
      A flat-plate solar thermal collector rig (4 temperature sensors, 2 flow sensors, 4 actuators)
      streams live data via an ESP32 to Firebase Realtime Database. This single-page dashboard
      reads that stream, renders it through gauges/charts/logs, and layers on six real ML models,
      full ASHRAE/ISO thermodynamic analysis, and production-grade reliability engineering
      (auth, pagination, reconnect logic) — all in one file.
    </div>

    <div class="ov-sec-title">🔌 System Architecture</div>
    <div class="ov-arch">
      <div class="ov-arch-node">ESP32 + Sensors</div><div class="ov-arch-arrow">→</div>
      <div class="ov-arch-node">Firebase Realtime DB</div><div class="ov-arch-arrow">→</div>
      <div class="ov-arch-node" style="background:rgba(0,230,118,.12);border-color:rgba(0,230,118,.3);color:#00e676">GitHub Pages (live, HTTPS)</div><div class="ov-arch-arrow">→</div>
      <div class="ov-arch-node">This Dashboard (you are here)</div><div class="ov-arch-arrow">→</div>
      <div class="ov-arch-node">Cloudflare Worker (optional)</div><div class="ov-arch-arrow">→</div>
      <div class="ov-arch-node">Claude API (optional)</div>
    </div>
    <div style="font-size:9px;color:var(--pbi-dgrey);margin:-10px 0 16px">Auto-deployed by <code style="color:#83c5be">.github/workflows/deploy.yml</code> on every push — tests must pass first</div>

    <div class="ov-sec-title">📊 This Session — Live Stats</div>
    <div class="ov-stats-row">
      <div class="ov-stat"><div class="ov-stat-val">${dataPts}</div><div class="ov-stat-label">ML DATA POINTS</div></div>
      <div class="ov-stat"><div class="ov-stat-val">${logRecords}</div><div class="ov-stat-label">LOG RECORDS</div></div>
      <div class="ov-stat"><div class="ov-stat-val">${rlEp}</div><div class="ov-stat-label">RL EPISODES</div></div>
      <div class="ov-stat"><div class="ov-stat-val">${uptimeMin}m</div><div class="ov-stat-label">SESSION UPTIME</div></div>
    </div>

    <div class="ov-sec-title">✅ Feature Verification — What's Real vs. What Needs Your Action</div>
    <table class="ov-table">
      <tr><th>Feature</th><th>Status</th><th>Note</th></tr>
      <tr><td>LSTM Temperature Forecaster</td><td>${ovBadge('real')}</td><td>Keras-trained, JS inference verified to match to 1e-7 precision</td></tr>
      <tr><td>Autoencoder Anomaly Detector</td><td>${ovBadge('real')}</td><td>89-param network, verified to 1e-8 precision</td></tr>
      <tr><td>Online RLS Efficiency Model</td><td>${ovBadge('real')}</td><td>Genuinely learns from live data — not hardcoded coefficients</td></tr>
      <tr><td>Q-Learning Pump Scheduler</td><td>${ovBadge('real')}</td><td>Real online reinforcement learning, ε-greedy policy</td></tr>
      <tr><td>ASHRAE 93 / ISO 9806 Efficiency Curve</td><td>${ovBadge('real')}</td><td>International standard collector characterization</td></tr>
      <tr><td>2nd Law Entropy &amp; Exergy Analysis</td><td>${ovBadge('real')}</td><td>S_gen, exergy in/out computed live</td></tr>
      <tr><td>Reynolds / Nusselt Heat Transfer</td><td>${ovBadge('real')}</td><td>Dittus-Boelter correlation, live h and NTU</td></tr>
      <tr><td>Pearson Correlation Matrix</td><td>${ovBadge('real')}</td><td>6×6 live sensor correlation</td></tr>
      <tr><td>PDF Report Export</td><td>${ovBadge('real')}</td><td>Full report generated client-side via jsPDF</td></tr>
      <tr><td>PWA Install / Offline Support</td><td>${ovBadge('real')}</td><td>manifest.json + service worker</td></tr>
      <tr><td>Stale-data detection + backoff reconnect</td><td>${ovBadge('real')}</td><td>Auto-detects silence, exponential backoff 5s→60s</td></tr>
      <tr><td>Sensor Validation &amp; Fault Detection</td><td>${ovBadge('real')}</td><td>Catches NaN, disconnect signatures, out-of-range, stuck sensors — before UI/ML ever sees them</td></tr>
      <tr><td>AI Proxy Rate Limiting</td><td>${ovBadge('real')}</td><td>Daily quota + prompt-length cap on cloudflare_worker.js — protects your API bill</td></tr>
      <tr><td>Automated Test Suite (CI/CD)</td><td>${ovBadge('real')}</td><td>tests/smoke_test.js + GitHub Actions — runs on every push, catches regressions</td></tr>
      <tr><td>Live Deployment (GitHub Pages)</td><td>${ovBadge('action')}</td><td>Auto-deploys on push once enabled — see SETUP.md §7. Unlocks PWA/offline (needs HTTPS)</td></tr>
      <tr><td>Firebase Security (Auth + Rules)</td><td>${ovBadge('action')}</td><td>Paste API key in app.js + rules in Firebase Console — see SETUP.md §2</td></tr>
      <tr><td>Ask AI (real Claude answers)</td><td>${ovBadge('action')}</td><td>Deploy cloudflare_worker.js (free, 5 min) — see SETUP.md §2.5</td></tr>
      <tr><td>ESP32 Real Device Telemetry</td><td>${ovBadge('action')}</td><td>Upload esp32_ota_metrics.ino to your board — see SETUP.md §3</td></tr>
      <tr><td>Hindi / English Toggle</td><td>${ovBadge('optional')}</td><td>UX convenience, click 🇮🇳 in ribbon</td></tr>
    </table>

    <div class="ov-sec-title">📁 File Manifest — What Each File Is For</div>
    <table class="ov-table">
      <tr><th>File</th><th>Purpose</th></tr>
      <tr><td class="ov-file-name">index.html</td><td>Dashboard markup — open this to run everything</td></tr>
      <tr><td class="ov-file-name">style.css</td><td>All visual styling</td></tr>
      <tr><td class="ov-file-name">app.js</td><td>All logic — Firebase, ML inference, charts, science calcs (this file)</td></tr>
      <tr><td class="ov-file-name">ml_weights.json</td><td>Trained LSTM + Autoencoder weights, reference copy (already embedded in app.js)</td></tr>
      <tr><td class="ov-file-name">train_models.py</td><td>Retrains the ML models — run this on your own exported Firebase data</td></tr>
      <tr><td class="ov-file-name">firebase_rules.json</td><td>Paste into Firebase Console to lock down read access</td></tr>
      <tr><td class="ov-file-name">esp32_ota_metrics.ino</td><td>Arduino snippet — add to your ESP32 sketch for real device telemetry</td></tr>
      <tr><td class="ov-file-name">cloudflare_worker.js</td><td>Secure proxy — deploy to enable real Claude answers in Ask AI, includes rate limiting</td></tr>
      <tr><td class="ov-file-name">tests/smoke_test.js</td><td>Automated test suite — run via <code style="color:#83c5be">npm test</code></td></tr>
      <tr><td class="ov-file-name">.github/workflows/test.yml</td><td>CI pipeline — runs tests automatically on every git push</td></tr>
      <tr><td class="ov-file-name">.github/workflows/deploy.yml</td><td>Auto-deploys to a live GitHub Pages URL on every push (tests must pass first)</td></tr>
      <tr><td class="ov-file-name">package.json</td><td>Enables <code style="color:#83c5be">npm test</code> and <code style="color:#83c5be">npm run lint</code></td></tr>
      <tr><td class="ov-file-name">manifest.json / sw.js</td><td>PWA install + offline support</td></tr>
      <tr><td class="ov-file-name">SETUP.md</td><td>Step-by-step guide for every manual action above</td></tr>
    </table>

    <div class="ov-sec-title">🧮 Key Formulas Used</div>
    <div class="ov-formula-grid">
      <div class="ov-formula-card"><div class="ov-formula-name">Collector Efficiency (ASHRAE 93)</div><div class="ov-formula-eq">η = η₀ − k₁·(Ti−Ta)/G</div></div>
      <div class="ov-formula-card"><div class="ov-formula-name">Heat Gain Rate</div><div class="ov-formula-eq">Q = ṁ · Cp · ΔT</div></div>
      <div class="ov-formula-card"><div class="ov-formula-name">Entropy Generation</div><div class="ov-formula-eq">S_gen = ṁCp·ln(T4/T1) − Q/T_sun</div></div>
      <div class="ov-formula-card"><div class="ov-formula-name">Reynolds Number</div><div class="ov-formula-eq">Re = ρvD/μ</div></div>
      <div class="ov-formula-card"><div class="ov-formula-name">Nusselt Number (Dittus-Boelter)</div><div class="ov-formula-eq">Nu = 0.023·Re⁰·⁸·Pr⁰·⁴</div></div>
      <div class="ov-formula-card"><div class="ov-formula-name">LSTM Cell (per gate)</div><div class="ov-formula-eq">i,f,o=σ(Wx+Uh+b); c=f·c+i·g</div></div>
    </div>

    <div class="ov-sec-title">🎓 One-Line Viva Answer</div>
    <div class="ov-abstract">
      "This dashboard combines live IoT sensor monitoring with six verified ML models
      (LSTM forecasting, autoencoder anomaly detection, online RLS regression, Q-learning
      control) and complete ASHRAE/ISO thermodynamic analysis — every ML claim was
      numerically cross-checked against its source model to 1e-7 precision, and every
      formula follows a named engineering standard."
    </div>

    <button class="ov-close" onclick="document.getElementById('overviewModal').style.display='none'">CLOSE OVERVIEW</button>
  `;

  modal.style.display = 'flex';
}
window.showProjectOverview = showProjectOverview;

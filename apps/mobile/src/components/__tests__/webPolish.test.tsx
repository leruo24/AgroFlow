import { act, render, waitFor } from '@testing-library/react-native';
import { SensorReadingsCard, WaterUsageCard } from '@/components/ZoneOverviewCards';
import { translate } from '@/i18n';
import { fetchTankStatus } from '@/services/agroFlowApi';
import type { Zone } from '@/context/AgroFlowContext';
jest.mock('@/context/ThemeContext',()=>({useTheme:()=>({colors:jest.requireActual('@/constants/colors').lightColors})}));
let mockAgro: Record<string,unknown> = {};
jest.mock('@/context/AgroFlowContext',()=>({useAgroFlow:()=>mockAgro}));
jest.mock('@/services/agroFlowApi',()=>({fetchTankStatus:jest.fn()}));
jest.mock('lucide-react-native',()=>new Proxy({},{get:(_target,key)=>key==='__esModule'?false:()=>null}));
const zone = { id:'1', lastReadingAt:null, sensors:{soilMoisture:{status:'Offline'},temperatureHumidity:{status:'Offline'}}, water:{flowRateLpm:0,usedTodayLitres:null,monthLitres:null} } as unknown as Zone;
const t=(key:Parameters<typeof translate>[1])=>translate('en',key);
const tank={farmId:1,capacityLitres:2500,estimatedRemainingLitres:2500,isLow:false};
beforeEach(()=>{jest.clearAllMocks(); mockAgro={farm:{id:'1'},refreshZones:jest.fn(),isFarmLoading:false,isZonesLoading:false};});

test('RET-08 a pending tank is Loading, never an invented missing tank',async()=>{
  let resolve!:(value:unknown)=>void;
  (fetchTankStatus as jest.Mock).mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  const view=await render(<SensorReadingsCard zone={zone}/>);
  expect(view.getByText(t('common.loading'))).toBeTruthy();
  expect(view.queryByText(t('sensor.noTank'))).toBeNull();
  await act(async()=>{resolve(tank);});
  expect(view.getByLabelText(/Water Tank, 2\s500 L/)).toBeTruthy();
  expect(view.queryByText(t('sensor.noTank'))).toBeNull();
});
test('RET-08 only a completed empty response shows No tank set up',async()=>{
  (fetchTankStatus as jest.Mock).mockResolvedValueOnce({...tank,capacityLitres:null,estimatedRemainingLitres:null});
  const view=await render(<SensorReadingsCard zone={zone}/>);
  await waitFor(()=>expect(view.getByText(t('sensor.noTank'))).toBeTruthy());
});
test('RET-08 a failed tank read is unavailable, not empty',async()=>{
  (fetchTankStatus as jest.Mock).mockRejectedValueOnce(new Error('fixture unavailable'));
  const view=await render(<SensorReadingsCard zone={zone}/>);
  await view.findByText(t('home.tankUnavailable'));
  expect(view.queryByText(t('sensor.noTank'))).toBeNull();
});
test('RET-08 loading sensor and usage data does not invent empty records',async()=>{
  mockAgro.isZonesLoading=true;
  (fetchTankStatus as jest.Mock).mockReturnValueOnce(new Promise(()=>{}));
  const view=await render(<><SensorReadingsCard zone={zone}/><WaterUsageCard zone={zone}/></>);
  expect(view.getAllByText(t('common.loading')).length).toBeGreaterThanOrEqual(8);
  expect(view.queryByText(t('sensor.noTank'))).toBeNull();
  expect(view.queryByText(t('empty.noWaterToday'))).toBeNull();
});

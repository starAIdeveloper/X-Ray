"""Build first. Optional CHROMIUM_PATH selects an existing browser executable."""
import os,json,pathlib,subprocess,time,atexit,io,tempfile,socket
from PIL import Image
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path(__file__).resolve().parents[1]
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
server=subprocess.Popen(['python','-m','http.server',str(port),'--bind','127.0.0.1','--directory',str(root/'dist')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
atexit.register(server.terminate)
time.sleep(.7)
def screenshot(page,name):
 Image.open(io.BytesIO(page.screenshot(full_page=True))).save(root/'docs/screenshots'/(name+'.webp'),quality=65)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or None,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1600,'height':1100},accept_downloads=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(f'http://127.0.0.1:{port}');page.get_by_role('heading',name='Reconstruction Dashboard',exact=True).wait_for()
 page.wait_for_timeout(700);assert page.locator('#viewport canvas').count()==1,'WebGL unavailable'
 assert page.evaluate('xrayDiagnostics().triangles')>0
 screenshot(page,'dashboard')
 page.locator('#display').select_option('wireframe');page.locator('#display').select_option('points');page.locator('#display').select_option('mesh');page.locator('#section').check();page.locator('#cut').fill('0.3');page.locator('#section').uncheck()
 page.locator('[data-action=measure]').click();box=page.locator('#viewport canvas').bounding_box()
 for y in [.35,.45,.55,.65]:
  for x in [.42,.48,.54,.60]:
   page.mouse.click(box['x']+box['width']*x,box['y']+box['height']*y)
   if 'Surface distance:' in page.locator('#measurement').inner_text():break
  if 'Surface distance:' in page.locator('#measurement').inner_text():break
 assert 'Surface distance:' in page.locator('#measurement').inner_text(),'No surface measurement'
 page.locator('nav button').filter(has_text='Calibration').click();page.locator('#spacing').fill('1.25');page.locator('#spacing').dispatch_event('change');assert page.evaluate('xrayDiagnostics().spacing')==1.25
 page.locator('nav button').filter(has_text='Segmentation').click();page.locator('#threshold').fill('0.65');page.locator('#threshold').dispatch_event('change');assert page.evaluate('xrayDiagnostics().threshold')==.65
 page.locator('[data-plane=Coronal]').click();page.locator('#slice').fill('12');expect(page.locator('#slice-label')).to_contain_text('13')
 screenshot(page,'segmentation')
 page.locator('nav button').filter(has_text='Reconstruction').click();page.locator('[data-action=phantom]').click();page.wait_for_function('!xrayDiagnostics().busy');assert page.evaluate('xrayDiagnostics().history')==1
 screenshot(page,'reconstruction')
 with page.expect_download() as d:page.locator('[data-action=stl]').first.click()
 assert d.value.suggested_filename.endswith('.stl');assert d.value.path().stat().st_size>1000
 with page.expect_download() as d:page.locator('[data-action=obj]').click()
 assert d.value.suggested_filename.endswith('.obj')
 with page.expect_download() as d:page.locator('[data-action=backup]').click()
 backup=d.value.path();data=json.loads(backup.read_text());assert len(data['volume'])==data['n']**3
 page.locator('nav button').filter(has_text='Reports').click();page.locator('[data-action=report]').click();assert page.evaluate('xrayDiagnostics().reports')==1
 with page.expect_download() as d:page.locator('[data-action=csv]').click()
 assert d.value.suggested_filename.endswith('.csv')
 screenshot(page,'reports')
 page.reload();assert page.evaluate('xrayDiagnostics().history')==1;assert page.evaluate('xrayDiagnostics().reports')==1
 page.locator('nav button').filter(has_text='Settings').click();assert page.locator('.reference-grid img').count()==5
 page.wait_for_function("[...document.querySelectorAll('.reference-grid img')].every(i=>i.complete&&i.naturalWidth>0)")
 page.locator('#backup-input').set_input_files(backup);expect(page.locator('#toast')).to_contain_text('restored');assert page.evaluate('xrayDiagnostics().spacing')==1.25
 page.locator('#backup-input').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{"version":999}'});expect(page.locator('#toast')).to_contain_text('rejected')
 page.locator('nav button').filter(has_text='X-Ray Import').click()
 with tempfile.TemporaryDirectory() as td:
  paths=[];n=data['n']
  for i,v in enumerate(data['views'][::4]):
   peak=max(v['data']) or 1;im=Image.new('L',(n,n));im.putdata([round(x/peak*255) for x in v['data']]);path=pathlib.Path(td)/f'projection-{i}.png';im.save(path);paths.append(str(path))
  page.locator('#upload').set_input_files(paths)
  expect(page.locator('#toast')).to_contain_text('Projections imported');assert page.evaluate('xrayDiagnostics().projections')==6;assert page.evaluate('xrayDiagnostics().triangles')==0
 page.locator('[data-angle="1"]').fill('0');page.locator('[data-angle="1"]').dispatch_event('change');expect(page.locator('#toast')).to_contain_text('unique')
 screenshot(page,'import')
 page.locator('nav button').filter(has_text='Reconstruction').click();page.locator('[data-action=reconstruct]').click();page.wait_for_function('!xrayDiagnostics().busy');assert page.evaluate('xrayDiagnostics().triangles')>0
 page.locator('[data-action=reconstruct]').click();page.locator('[data-action=cancel]').click();assert not page.evaluate('xrayDiagnostics().busy')
 page.set_viewport_size({'width':390,'height':844});page.locator('nav button').filter(has_text='Dashboard').click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 screenshot(page,'mobile')
 assert not errors,errors
 (root/'docs/browser-report.json').write_text(json.dumps({'passed':True,'checks':['production build navigation','WebGL mesh/points/wireframe','section plane','raycast measurement','voxel calibration','threshold','slice plane/index','worker reconstruction','STL OBJ exports','volume backup','reports/CSV','metadata persistence','built reference assets','restore/rejection','multi-image import','angle validation','imported reconstruction','job cancellation','mobile layout'],'pageErrors':errors},indent=2))
 browser.close();print('Browser checks passed')

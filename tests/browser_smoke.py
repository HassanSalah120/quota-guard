"""Run against a local synthetic page: verifies real browser JS execution, not live Facebook/X."""
import os
from playwright.sync_api import sync_playwright
D=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def script(p,name): p.add_script_tag(path=os.path.join(D,name))
with sync_playwright() as browser:
    b=browser.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    p=b.new_page()
    p.set_content('''<div data-testid="videoPlayer" id="player"><video id="video"></video>
      <button id="settings" aria-label="Video settings">Settings</button></div>
      <script>
      document.getElementById('settings').onclick=()=>{
        const menu=document.createElement('div'); menu.role='menu'; menu.id='menu';
        const button=document.createElement('button'); button.textContent='Quality';
        button.onclick=()=>{menu.innerHTML=''; for(const res of ['240p','360p','720p']){
          const item=document.createElement('button'); item.textContent=res;
          item.onclick=()=>{ document.body.dataset.selected=res;menu.remove(); };
          menu.append(item);
        }}; menu.append(button); document.body.append(menu);
      };
      </script>''')
    script(p,'quality.js');script(p,'player-quality.js')
    result=p.evaluate('''() => {
      const v=document.getElementById('video');
      const gear=QuotaGuardPlayer.gear(v); gear.click();
      QuotaGuardPlayer.qualitySubmenuAction().click();
      QuotaGuardPlayer.resolutionAction('360').click();
      return {selected:document.body.dataset.selected,settings:gear.id};
    }''')
    assert result=={'selected':'360p','settings':'settings'},result
    print('PASS: Chromium video player settings-menu → Quality → 360p')

    p.set_content('<main id="status"></main>')
    script(p,'hls-quality.js')
    p.evaluate('''() => {
      document.documentElement.setAttribute('data-qg-enabled','yes');
      document.documentElement.setAttribute('data-qg-quality','360');
      window.fetch=async()=>new Response(
        '#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=320x180\\n/low.m3u8\\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360\\n/med.m3u8\\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\\n/high.m3u8\\n', {status:200});
    }''')
    script(p,'stream-hook.js')
    result=p.evaluate('''async () => {
      const r=await fetch('https://video.twimg.com/ext_tw_video/123/pu/pl/index.m3u8');
      return {body:await r.text(), status:document.documentElement.getAttribute('data-qg-quality-applied'),
              responseType:r instanceof Response, responseStatus:r.status};
    }''')
    assert result['status']=='360p HLS cap applied',result
    assert '/med.m3u8' in result['body'] and '/high.m3u8' not in result['body'] and '/low.m3u8' not in result['body'],result
    assert result['responseType'] and result['responseStatus']==200,result
    print('PASS: Chromium intercepted X HLS fetch returns only 360p variant and updates status')
    b.close()

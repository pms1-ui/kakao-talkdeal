// 회차 작업용.html 전체를 맨위~맨아래 한 장(세로 긴 이미지)으로 캡처 → 루트폴더 저장
// 사용법: node _스크립트/capture_full_stitch.mjs [회차]   (예: node _스크립트/capture_full_stitch.mjs 260918)
//         회차 생략 시 기본 260911.
//
// 긴 페이지가 중간에 끊기는 문제를 막기 위해 구간별로 나눠 캡처 후 세로로 이어붙이고,
// (1) 이미지 로드 검증 (2) 페이지 높이 == 결과 이미지 높이 검증 을 수행한다.
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { resolve } from 'path';
import { existsSync, mkdirSync, unlinkSync, statSync, readdirSync } from 'fs';

const ROUND = process.argv[2] || '260911';   // 회차 (인자로 받음)
const BASE = resolve('.');
const SOURCE = resolve(BASE, '_작업소스', ROUND);
const htmlFile = resolve(SOURCE, '작업용.html');
if (!existsSync(htmlFile)) {
  console.error('❌ 작업용.html 없음:', htmlFile);
  process.exit(1);
}
const htmlPath = `file://${htmlFile}`;

const WIDTH = 890;            // 페이지 CSS 폭
const SCALE = 2;              // deviceScaleFactor (레티나 선명도)
const SEG_CSS = 1500;         // 한 조각의 CSS 높이 (px) - 안전하게 작게 유지
const QUALITY = 92;
const TMP = resolve(BASE, `_tmp_stitch_${ROUND}`);
const OUT_JPG = resolve(BASE, `${ROUND}_전체.jpg`);

async function main() {
  console.log(`▶ ${ROUND} 회차 전체 캡처 시작`);
  if (existsSync(TMP)) {
    for (const f of readdirSync(TMP)) unlinkSync(resolve(TMP, f));
  } else {
    mkdirSync(TMP, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: SEG_CSS, deviceScaleFactor: SCALE });
  await page.goto(htmlPath, { waitUntil: 'networkidle0', timeout: 120000 });

  // 폰트/이미지 완전 로드 대기
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const imgs = Array.from(document.images);
    await Promise.all(imgs.map(img => img.complete && img.naturalWidth > 0
      ? Promise.resolve()
      : new Promise(res => { img.onload = img.onerror = res; })));
  });
  await new Promise(r => setTimeout(r, 800));

  // (1) 깨진 이미지 검증
  const brokenImgs = await page.evaluate(() =>
    Array.from(document.images)
      .filter(img => !img.complete || img.naturalWidth === 0)
      .map(img => img.getAttribute('src'))
  );
  if (brokenImgs.length) {
    console.warn('⚠️ 로드 실패 이미지 ' + brokenImgs.length + '개:');
    brokenImgs.forEach(s => console.warn('   - ' + s));
  } else {
    console.log('✅ 모든 이미지 로드 성공');
  }

  const fullHeightCss = await page.evaluate(() => Math.ceil(document.body.scrollHeight));
  const fullPx = fullHeightCss * SCALE;
  const segCount = Math.ceil(fullHeightCss / SEG_CSS);
  console.log('전체 CSS 높이:', fullHeightCss, 'px → 실제', fullPx + 'px,  조각', segCount + '개');

  const parts = [];
  for (let i = 0; i < segCount; i++) {
    const yCss = i * SEG_CSS;
    const hCss = Math.min(SEG_CSS, fullHeightCss - yCss);
    const partPath = resolve(TMP, `seg_${String(i).padStart(3, '0')}.png`);
    await page.screenshot({
      path: partPath,
      clip: { x: 0, y: yCss, width: WIDTH, height: hCss }
    });
    parts.push({ path: partPath, topPx: yCss * SCALE });
    process.stdout.write(`  조각 ${i + 1}/${segCount}\r`);
  }
  console.log('\n조각 캡처 완료. 이어붙이는 중...');
  await browser.close();

  // 세로로 이어붙이기
  const composites = parts.map(p => ({ input: p.path, top: p.topPx, left: 0 }));
  const png = resolve(BASE, `${ROUND}_전체.png`);
  await sharp({
    create: { width: WIDTH * SCALE, height: fullPx, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).composite(composites).png().toFile(png);

  // (2) 높이 검증
  const meta = await sharp(png).metadata();
  console.log('이어붙인 이미지:', meta.width + 'x' + meta.height, '(예상 ' + fullPx + ')');
  if (meta.height !== fullPx) {
    console.warn('⚠️ 높이 불일치! 예상 ' + fullPx + ' vs 실제 ' + meta.height + ' — 잘림 의심');
  } else {
    console.log('✅ 높이 검증 통과 (잘림 없음)');
  }

  await sharp(png).jpeg({ quality: QUALITY }).toFile(OUT_JPG);
  unlinkSync(png);
  for (const f of readdirSync(TMP)) unlinkSync(resolve(TMP, f));

  const kb = Math.round(statSync(OUT_JPG).size / 1024);
  console.log(`✅ 저장 완료: ${ROUND}_전체.jpg  (${kb}KB, ${meta.width}x${meta.height})`);
}
main().catch(err => { console.error('❌ 에러:', err); process.exit(1); });

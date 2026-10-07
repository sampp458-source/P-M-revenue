// Real browser regression runner. Inject a CUA tab bound to the isolated Composer fixture.
// Fixtures: eligible recipients 정하성/이화인; no real API/network or business writes.
// Run at 1440 and 390, capture DOM native event trace via the fixture's #event-trace.
export async function verifyRecipientPicker(tab, save) {
 const p=tab.playwright;
 const assert=(condition,message)=>{if(!condition)throw new Error(message);};
 const chips=()=>p.locator('.pt-recipient-chips button').count();
 const open=()=>p.getByPlaceholder('이름으로 담당자 검색').click();
 await open();
 assert(await p.getByRole('group',{name:'담당자 검색 결과'}).isVisible(),'open');
 await save('open');
 await p.getByText('정하성',{exact:true}).click();
 assert(await chips()===1,'text click selects exactly once');
 assert(await p.getByRole('group',{name:'담당자 검색 결과'}).isVisible(),'internal click keeps results');
 await save('one-selected');
 await p.getByRole('checkbox',{name:'정하성',exact:true}).click();
 assert(await chips()===0,'direct checkbox deselects once');
 await p.locator('.pt-check').filter({hasText:'정하성'}).click();
 assert(await chips()===1,'whole row selects once');
 await p.getByText('이화인',{exact:true}).click();
 assert(await chips()===2,'second text click selects');
 await save('two-selected');
 await p.getByRole('button',{name:'정하성 선택 제거'}).click();
 assert(await chips()===1,'open chip removal');
 await save('one-removed');
 await p.getByPlaceholder('이름으로 담당자 검색').fill('검색없음');
 assert(await chips()===1,'empty search preserves selection');
 assert(await p.getByText('검색 결과가 없습니다.').isVisible(),'empty search');
 await p.getByPlaceholder('이름으로 담당자 검색').fill('');
 await p.getByLabel('제목',{exact:true}).click();
 assert(await p.locator('.pt-recipient-results').count()===0,'outside blur closes');
 await p.getByRole('button',{name:'이화인 선택 제거'}).click();
 assert(await chips()===0,'closed chip removal');
 await open();
 await p.getByPlaceholder('이름으로 담당자 검색').press('Tab');
 await p.getByRole('checkbox',{name:'정하성',exact:true}).press('Space');
 assert(await chips()===1,'Space selects');
 await p.getByRole('checkbox',{name:'정하성',exact:true}).press('Enter');
 assert(await chips()===0,'Enter deselects once');
 await p.getByRole('checkbox',{name:'정하성',exact:true}).press('Escape');
 assert(await p.locator('.pt-recipient-results').count()===0,'Escape closes picker');
 assert(await p.getByRole('dialog').count()===1,'Escape preserves composer');
 const due=await p.evaluate(()=>{const input=document.querySelector('input[aria-label="완료기한"]');return {value:input.value,type:input.type,defaultValue:input.defaultValue,attribute:input.getAttribute('value'),placeholder:input.getAttribute('placeholder'),state:input.getAttribute('data-react-due')};});
 assert(due.value===''&&due.type==='text','fresh due empty text presentation');
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 assert(overflow===0,'no horizontal overflow');
 await save('final');
 return {passed:true,due,overflow,trace:await p.locator('#event-trace').textContent()};
}

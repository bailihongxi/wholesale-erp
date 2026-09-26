import{k as Q,A as f,B as b,D as n,G as g,F as U,H as D,U as $,e as V,r as N,w as H,b as Y,o as G,s as v,Y as K,u as J,V as P,X as L,E as I}from"./vue-vendor-07M7iixH.js";import{_ as R}from"./index-BmbI5h9m.js";import{r as W,g as j,P as B,s as O,d as X}from"./printSettings-ieRW10Dp.js";const Z={class:"ui-items"},tt={class:"block-title"},et={class:"ui-items-list"},nt={class:"ui-items-name"},ot={class:"nm"},st={key:0,class:"ui-items-tag"},at={class:"ui-items-calc"},lt={class:"ui-items-qty"},it={class:"ui-items-price"},rt={class:"ui-items-amount"},pt={key:1,class:"ui-items-note"},dt={key:0,class:"ui-items-empty"},ct={key:0,class:"ui-items-total"},ut={class:"ui-items-total-qty"},mt={key:0,class:"ui-items-total-amount"},gt=Q({__name:"ItemCards",props:{title:{default:"商品明细"},items:{},showPrice:{type:Boolean,default:!0},showTotal:{type:Boolean,default:!0},qtyUnit:{default:"件"},totalQty:{},totalAmount:{},emptyText:{default:"暂无明细"}},setup(t){const e=t;function s(d){return(Number.isFinite(Number(d))?Number(d):0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}const m=V(()=>e.totalQty!==void 0?e.totalQty:e.items.reduce((d,i)=>d+(i.qty||0),0)),u=V(()=>e.totalAmount!==void 0?e.totalAmount:e.items.reduce((d,i)=>d+Number(i.amount??(i.qty||0)*(i.price||0)),0));return(d,i)=>(f(),b("div",Z,[n("h4",tt,g(t.title)+"（"+g(t.items.length)+"）",1),n("ul",et,[(f(!0),b(U,null,D(t.items,(l,a)=>(f(),b("li",{key:a,class:"ui-items-row"},[n("div",nt,[n("span",ot,g(l.name),1),l.tag?(f(),b("span",st,g(l.tag),1)):$("",!0)]),n("div",at,[n("span",lt,g(l.qty)+g(l.unit?" "+l.unit:""),1),t.showPrice&&l.price!=null?(f(),b(U,{key:0},[i[0]||(i[0]=n("span",{class:"ui-items-op"},"×",-1)),n("span",it,"¥"+g(s(l.price)),1),i[1]||(i[1]=n("span",{class:"ui-items-op"},"=",-1)),n("b",rt,"¥"+g(s(l.amount??(l.qty||0)*(l.price||0))),1)],64)):$("",!0),l.note?(f(),b("span",pt,g(l.note),1)):$("",!0)])]))),128)),t.items.length?$("",!0):(f(),b("li",dt,g(t.emptyText),1))]),t.items.length&&t.showTotal?(f(),b("div",ct,[i[2]||(i[2]=n("span",null,"合计",-1)),n("span",ut,g(m.value)+" "+g(t.qtyUnit),1),t.showPrice?(f(),b("b",mt,"¥"+g(s(u.value)),1)):$("",!0)])):$("",!0)]))}}),le=R(gt,[["__scopeId","data-v-6f066090"]]);function ft(t,e="打印"){const s=window.open("","_blank","width=900,height=1200");return s?(s.document.open(),s.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${ht(e)}</title><style>@page { size: A4; margin: 14mm; } body { margin: 0; }</style></head><body>${t}</body></html>`),s.document.close(),s.focus(),s.print(),!0):!1}function bt(t){const e=t==null?void 0:t.contentWindow;if(!e||typeof e.print!="function")return!1;try{return e.focus(),e.print(),!0}catch{return!1}}function ht(t){return t.replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}const yt={A5:{base:"11px",co:"16px",title:"13px"},A4:{base:"12.5px",co:"19px",title:"15px"}};function vt(t){const e=B[t],s=yt[t];return`
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
    color: #1a202c; background: #fff;
  }

  /* 一页 = 一张纸：预览时按真实尺寸呈现，打印时铺满 @page */
  .page {
    width: ${e.w}mm;
    min-height: ${e.h}mm;
    margin: 0 auto;
    padding: 7mm 6mm;
    font-size: ${s.base};
    background: #fff;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .hd { text-align: center; padding-bottom: 6px; border-bottom: 2px solid #1a365d; }
  /* 头部一行排布：公司抬头居左、单据标题绝对居中（三列 grid，两侧 1fr 平衡） */
  .hd-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .hd-date { font-size: 11px; font-weight: 400; letter-spacing: 0; color: #475569; margin-left: 8px; }
  .hd-ono { font-size: 12px; justify-self: end; white-space: nowrap; }
  .sign .hd-page { flex: none !important; margin-left: 16px; font-size: 11px; color: #64748b; }
  .pno { margin-top: 6px; text-align: right; font-size: 11px; color: #64748b; }
  .hd-co { font-size: ${s.co}; font-weight: 700; letter-spacing: 2px; color: #1a365d; margin: 0; justify-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hd-title { font-size: ${s.title}; font-weight: 600; letter-spacing: 6px; margin: 0; color: #1a365d; justify-self: center; white-space: nowrap; }
  .hd-sub { font-size: ${s.base}; color: #64748b; margin: 2px 0 0; }
  .hd-info { font-size: ${s.base}; color: #64748b; margin: 2px 0 0; }

  .meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 2px 12px;
          margin: 7px 0 6px; color: #475569; }
  .meta span b { color: #1a202c; font-weight: 600; }

  .party { border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px 9px; margin-bottom: 8px; }
  .party-grid { display: flex; flex-wrap: wrap; gap: 4px 18px; }
  .party-grid .f { min-width: 45%; }
  .party-grid .f i { font-style: normal; color: #64748b; margin-right: 4px; }

  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #eef2f7; color: #1a365d; font-weight: 600;
    border: 1px solid #94a3b8; padding: 5px 6px; text-align: left;
    white-space: nowrap;
  }
  tbody td { border: 1px solid #cbd5e1; padding: 5px 6px; }
  tbody tr { page-break-inside: avoid; break-inside: avoid; }
  .c-no { width: 42px; text-align: center; }
  .c-qty { width: 58px; text-align: right; }
  .c-unit { width: 42px; text-align: center; }
  .c-cat { width: 72px; }
  .c-price, .c-amt { width: 78px; text-align: right; }
  td.num, th.num { text-align: right; }

  tfoot td { border: 1px solid #94a3b8; padding: 6px; font-weight: 700; background: #f8fafc; }
  .total-label { text-align: right; }

  .remark { margin-top: 8px; color: #475569; border-left: 3px solid #cbd5e1; padding-left: 7px; }

  /* 不贴底：内容自上而下紧凑排列，避免表格与签章/页脚之间塌出大片空白 */
  .sign { margin-top: 14px; padding-top: 10px; display: flex; justify-content: space-between;
          color: #475569; }
  .sign .s { flex: 1; }
  .sign .line { display: inline-block; min-width: 90px; border-bottom: 1px solid #94a3b8; }

  .foot { margin-top: 8px; padding-top: 5px; border-top: 1px dashed #cbd5e1; text-align: center;
          color: #94a3b8; font-size: 0.92em; }

  /* 屏幕预览：画出纸张边界与阴影，方便确认分页效果 */
  @media screen {
    body { background: #eef2f7; padding: 14px; }
    .page { border: 1px solid #cbd5e1; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.1); margin-bottom: 14px; }
  }

  @page { size: ${e.w}mm ${e.h}mm; margin: 0; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 0; }
    .page { width: ${e.w}mm; min-height: ${e.h}mm; margin: 0; border: none; box-shadow: none;
            page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    thead { display: table-header-group; }
  }
`}function xt(){const t=j();if(t.companyName.trim())return t.companyName.trim();try{const e=localStorage.getItem("erp_company");if(e){const s=JSON.parse(e);if(s&&typeof s.name=="string"&&s.name.trim())return s.name.trim()}}catch{}return"家电批发"}function c(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function z(t){return(Number.isFinite(t)?t:0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}function wt(t,e){if(!t.length)return[[]];const s=Math.max(3,e-3),m=Math.max(3,e-4);if(t.length<=s)return[t];const u=[];let d=0;for(;d<t.length;){const i=t.length-d,l=u.length===0;if(i<=(l?s:m)){u.push(t.slice(d));break}let a;l?a=s:i<=e+m?a=Math.ceil(i/2):a=e,a=Math.max(1,Math.min(a,i-1)),u.push(t.slice(d,d+a)),d+=a}return u}const $t=["qty","price","amount"],y={no:"c-no",name:"",category:"c-cat",model:"",unit:"c-unit",qty:"num c-qty",price:"num c-price",amount:"num c-amt"};function kt(t,e){return t.columns.filter(s=>s.on&&(e||s.key!=="price"&&s.key!=="amount"))}function Pt(t){return t.map(e=>`<th class="${y[e.key]}">${c(e.label)}</th>`).join("")}function Nt(t,e,s){return`<tr>${t.map(u=>{switch(u.key){case"no":return`<td class="${y.no}">${s}</td>`;case"name":return`<td>${c(e.brand||e.productName)}</td>`;case"category":return`<td class="${y.category}">${c(e.category)}</td>`;case"model":return`<td>${c(e.model)}</td>`;case"unit":return`<td class="${y.unit}">${c(e.unit)}</td>`;case"qty":return`<td class="${y.qty}">${e.quantity}</td>`;case"price":return e.isGift?`<td class="${y.price}">—</td>`:`<td class="${y.price}">${z(e.price)}</td>`;case"amount":return e.isGift?`<td class="${y.amount}">赠品</td>`:`<td class="${y.amount}">${z(e.subtotal)}</td>`;default:return"<td></td>"}}).join("")}</tr>`}function _t(t,e,s){const m=t.findIndex(l=>$t.includes(l.key)),u=m>0?m:t.length,d=t.slice(u);if(!d.length)return`<tfoot><tr><td colspan="${Math.max(1,u)}" class="total-label">合计（数量 ${e.totalQuantity}${s?`　金额 ¥${z(e.totalAmount)}`:""}）</td></tr></tfoot>`;const i=d.map(l=>l.key==="qty"?`<td class="${y.qty}">${e.totalQuantity}</td>`:l.key==="price"?`<td class="${y.price}"></td>`:l.key==="amount"?`<td class="${y.amount}">¥${z(e.totalAmount)}</td>`:"<td></td>").join("");return`<tfoot><tr><td colspan="${u}" class="total-label">合计</td>${i}</tr></tfoot>`}function Ct(t,e,s){const{showPrice:m,pageNo:u,pageCount:d,startNo:i,isFirst:l,isLast:a,settings:h}=s,x=kt(h,m),_=Math.max(1,x.length),C=e.length?e.map((p,o)=>Nt(x,p,i+o)).join(""):`<tr><td colspan="${_}" style="text-align:center;color:#94a3b8;padding:14px;">无明细</td></tr>`,E=a?_t(x,t,m):"",S=a&&t.remark?`<div class="remark">备注：${c(t.remark)}</div>`:"",F=t.partyLabel==="供应商"?["制单人","采购主管","供应商确认"]:["制单人","仓库发货","客户签收"],T=a&&h.showSign?`<div class="sign">${F.map(p=>`<span class="s">${p}：<span class="line"></span></span>`).join("")}</div>`:"",A=`<div class="pno">第 ${u} / ${d} 页</div>`,q=l?`<div class="party"><div class="party-grid">
         <span class="f"><i>${c(t.partyLabel)}</i>${c(t.partyName)||"—"}</span>
         ${t.partyContact?`<span class="f"><i>联系人</i>${c(t.partyContact)}</span>`:""}
         ${t.partyPhone?`<span class="f"><i>电话</i>${c(t.partyPhone)}</span>`:""}
         ${t.partyAddress?`<span class="f"><i>地址</i>${c(t.partyAddress)}</span>`:""}
       </div></div>`:"",M=[h.companyAddress,h.companyPhone].filter(Boolean).map(c).join("　");return`<section class="page">
    <div class="hd">
      <div class="hd-row">
        <span class="hd-co">${c(h.companyName.trim()||t.companyName||xt())} <span class="hd-date">${c(t.date)}</span></span>
        <span class="hd-title">${c(t.title)}</span>
        <span class="hd-ono">单号：<b>${c(t.orderNo)}</b></span>
      </div>
      ${h.subtitle?`<p class="hd-sub">${c(h.subtitle)}</p>`:""}
      ${M?`<p class="hd-info">${M}</p>`:""}
    </div>

    <div class="meta">
      ${t.operatorName?`<span>制单：<b>${c(t.operatorName)}</b></span>`:""}
    </div>

    ${q}

    <table>
      <thead><tr>${Pt(x)}</tr></thead>
      <tbody>${C}</tbody>
      ${E}
    </table>

    ${S}
    ${T}

    <div class="foot">${c(h.footNote)}</div>
    ${A}
  </section>`}function St(t,e,s=j()){const m=W(s),u=wt(t.items,m),d=u.length;let i=1;const l=u.map((a,h)=>{const x=Ct(t,a,{showPrice:e,pageNo:h+1,pageCount:d,startNo:i,isFirst:h===0,isLast:h===d-1,settings:s});return i+=a.length,x}).join(`
`);return`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c(t.title)} ${c(t.orderNo)}</title>
<style>${vt(s.paper)}</style>
</head>
<body>
${l}
</body>
</html>`}const At={key:0,class:"pp-mask"},qt=["aria-label"],Mt={class:"pp-head"},Ut={class:"pp-title"},Vt={class:"pp-head-right"},jt={class:"pp-field inline"},zt=["value"],Et={key:0,class:"pp-editor"},Ft={class:"pp-edit-grid"},Tt={class:"pp-field"},Ht={class:"pp-field"},Lt={class:"pp-field"},Dt={class:"pp-field"},Bt={class:"pp-field wide"},It={class:"pp-field"},Ot={class:"pp-check"},Qt={class:"pp-cols"},Rt={class:"pp-col-on"},Yt=["onUpdate:modelValue"],Gt=["onUpdate:modelValue"],Kt={class:"pp-col-move"},Jt=["disabled","onClick"],Wt=["disabled","onClick"],Xt={class:"pp-body"},Zt=["srcdoc","title"],te={class:"pp-foot"},ee={key:0,class:"pp-toggle"},ne=Q({__name:"PrintPreview",props:{visible:{type:Boolean},title:{},html:{default:""},orderData:{default:null},allowPriceToggle:{type:Boolean,default:!0},showPrice:{type:Boolean,default:!0}},emits:["cancel","print","update:showPrice"],setup(t,{emit:e}){const s=t,m=e,u=N(null),d=N(s.showPrice),i=N(!1),l=N(j()),a=N({...l.value}),h=Object.keys(B).map(p=>({value:p,label:B[p].label})),x=V({get:()=>l.value.paper,set:p=>{l.value.paper=p,a.value.rowsPerPage||(l.value.rowsPerPage=0),O(l.value)}}),_=V(()=>s.orderData?St(s.orderData,d.value,l.value):s.html);H(()=>s.showPrice,p=>{d.value=p}),H(d,p=>m("update:showPrice",p)),H(()=>s.visible,p=>{p&&(l.value=j(),a.value=C(l.value),i.value=!1)});function C(p){return{...p,columns:p.columns.map(o=>({...o}))}}function E(){i.value=!i.value,i.value&&(a.value=C(l.value))}function S(p,o){const r=a.value.columns,w=p+o;if(w<0||w>=r.length)return;const k=r[p];r[p]=r[w],r[w]=k}function F(){const p={...l.value,companyName:a.value.companyName,subtitle:a.value.subtitle,companyAddress:a.value.companyAddress,companyPhone:a.value.companyPhone,footNote:a.value.footNote,showSign:a.value.showSign,rowsPerPage:Number.isFinite(a.value.rowsPerPage)&&a.value.rowsPerPage>0?Math.floor(a.value.rowsPerPage):0,columns:a.value.columns.map(o=>({key:o.key,label:String(o.label??"").trim()||o.label,on:o.on!==!1}))};l.value=p,O(p),i.value=!1}function T(){const p=X();a.value={...p,paper:l.value.paper,rowsPerPage:l.value.rowsPerPage}}function A(){m("cancel")}function q(p){p.key==="Escape"&&s.visible&&A()}Y(()=>window.addEventListener("keydown",q)),G(()=>window.removeEventListener("keydown",q));function M(){bt(u.value)||ft(_.value,s.title),m("print")}return(p,o)=>t.visible?(f(),b("div",At,[n("div",{class:"pp-dialog",role:"dialog","aria-modal":"true","aria-label":t.title},[n("div",Mt,[n("span",Ut,g(t.title),1),n("div",Vt,[n("label",jt,[o[9]||(o[9]=n("span",null,"纸张",-1)),v(n("select",{"onUpdate:modelValue":o[0]||(o[0]=r=>x.value=r),class:"pp-select"},[(f(!0),b(U,null,D(J(h),r=>(f(),b("option",{key:r.value,value:r.value},g(r.label),9,zt))),128))],512),[[K,x.value]])]),n("button",{class:"pp-btn-mini",type:"button",onClick:E},g(i.value?"收起表头设置":"⚙ 表头设置"),1)])]),i.value?(f(),b("div",Et,[n("div",Ft,[n("label",Tt,[o[10]||(o[10]=n("span",null,"公司抬头",-1)),v(n("input",{"onUpdate:modelValue":o[1]||(o[1]=r=>a.value.companyName=r),type:"text",placeholder:"如：某某家电批发"},null,512),[[P,a.value.companyName]])]),n("label",Ht,[o[11]||(o[11]=n("span",null,"副标题",-1)),v(n("input",{"onUpdate:modelValue":o[2]||(o[2]=r=>a.value.subtitle=r),type:"text",placeholder:"如：送货凭证 / 出库单"},null,512),[[P,a.value.subtitle]])]),n("label",Lt,[o[12]||(o[12]=n("span",null,"公司地址",-1)),v(n("input",{"onUpdate:modelValue":o[3]||(o[3]=r=>a.value.companyAddress=r),type:"text",placeholder:"选填"},null,512),[[P,a.value.companyAddress]])]),n("label",Dt,[o[13]||(o[13]=n("span",null,"公司电话",-1)),v(n("input",{"onUpdate:modelValue":o[4]||(o[4]=r=>a.value.companyPhone=r),type:"text",placeholder:"选填"},null,512),[[P,a.value.companyPhone]])]),n("label",Bt,[o[14]||(o[14]=n("span",null,"页脚文字",-1)),v(n("input",{"onUpdate:modelValue":o[5]||(o[5]=r=>a.value.footNote=r),type:"text",placeholder:"选填"},null,512),[[P,a.value.footNote]])]),n("label",It,[o[15]||(o[15]=n("span",null,"每页行数",-1)),v(n("input",{"onUpdate:modelValue":o[6]||(o[6]=r=>a.value.rowsPerPage=r),type:"number",min:"0",placeholder:"0 = 按纸张自动"},null,512),[[P,a.value.rowsPerPage,void 0,{number:!0}]])]),n("label",Ot,[v(n("input",{"onUpdate:modelValue":o[7]||(o[7]=r=>a.value.showSign=r),type:"checkbox"},null,512),[[L,a.value.showSign]]),o[16]||(o[16]=I(" 显示签章栏 ",-1))])]),n("div",Qt,[o[17]||(o[17]=n("div",{class:"pp-cols-title"},"明细表字段（勾选 / 改名 / 调顺序）",-1)),(f(!0),b(U,null,D(a.value.columns,(r,w)=>(f(),b("div",{key:r.key,class:"pp-col-row"},[n("label",Rt,[v(n("input",{"onUpdate:modelValue":k=>r.on=k,type:"checkbox"},null,8,Yt),[[L,r.on]])]),v(n("input",{"onUpdate:modelValue":k=>r.label=k,class:"pp-col-label",type:"text"},null,8,Gt),[[P,r.label]]),n("div",Kt,[n("button",{class:"pp-btn-mini tiny",type:"button",disabled:w===0,onClick:k=>S(w,-1)},"↑",8,Jt),n("button",{class:"pp-btn-mini tiny",type:"button",disabled:w===a.value.columns.length-1,onClick:k=>S(w,1)},"↓",8,Wt)])]))),128))]),n("div",{class:"pp-edit-actions"},[n("button",{class:"pp-btn-mini",type:"button",onClick:T},"恢复默认"),n("button",{class:"pp-btn-mini primary",type:"button",onClick:F},"保存表头")])])):$("",!0),n("div",Xt,[n("iframe",{ref_key:"frameEl",ref:u,class:"pp-frame",srcdoc:_.value,title:t.title},null,8,Zt)]),n("div",te,[t.allowPriceToggle?(f(),b("label",ee,[v(n("input",{"onUpdate:modelValue":o[8]||(o[8]=r=>d.value=r),type:"checkbox"},null,512),[[L,d.value]]),o[18]||(o[18]=I(" 打印含单价 ",-1))])):$("",!0),n("div",{class:"pp-btns"},[n("button",{class:"pp-btn ghost btn-cancel",type:"button",onClick:A},"取消"),n("button",{class:"pp-btn primary btn-print",type:"button",onClick:M},"🖨 打印")])])],8,qt)])):$("",!0)}}),ie=R(ne,[["__scopeId","data-v-e5770a01"]]);export{le as I,ie as P,St as b,xt as g};

import{k as R,A as b,B as h,D as n,G as g,F as U,H as B,U as w,e as V,r as _,w as T,b as Y,o as G,s as x,Y as K,u as W,V as N,X as H,E as O}from"./vue-vendor-07M7iixH.js";import{_ as Q}from"./index-DmsEG84m.js";import{r as J,a as X,g as M,P as D,s as I,d as Z}from"./printSettings-CF-SpSAN.js";const tt={class:"ui-items"},et={class:"block-title"},nt={class:"ui-items-list"},ot={class:"ui-items-name"},st={class:"nm"},at={key:0,class:"ui-items-tag"},lt={class:"ui-items-calc"},it={class:"ui-items-qty"},rt={class:"ui-items-price"},pt={key:0,class:"ui-items-note lead"},dt={class:"ui-items-amount"},ct={key:1,class:"ui-items-note"},ut={key:0,class:"ui-items-empty"},mt={key:0,class:"ui-items-total"},ft={class:"ui-items-total-qty"},gt={key:0,class:"ui-items-total-amount"},bt=R({__name:"ItemCards",props:{title:{default:"商品明细"},items:{},showPrice:{type:Boolean,default:!0},showTotal:{type:Boolean,default:!0},qtyUnit:{default:"件"},totalQty:{},totalAmount:{},emptyText:{default:"暂无明细"},noteLead:{type:Boolean,default:!1}},setup(t){const e=t;function a(i){return!!e.noteLead&&i.note!=null&&e.showPrice&&i.price!=null}function c(i){return(Number.isFinite(Number(i))?Number(i):0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}const f=V(()=>e.totalQty!==void 0?e.totalQty:e.items.reduce((i,l)=>i+(l.qty||0),0)),d=V(()=>e.totalAmount!==void 0?e.totalAmount:e.items.reduce((i,l)=>i+Number(l.amount??(l.qty||0)*(l.price||0)),0));return(i,l)=>(b(),h("div",tt,[n("h4",et,g(t.title)+"（"+g(t.items.length)+"）",1),n("ul",nt,[(b(!0),h(U,null,B(t.items,(o,m)=>(b(),h("li",{key:m,class:"ui-items-row"},[n("div",ot,[n("span",st,g(o.name),1),o.tag?(b(),h("span",at,g(o.tag),1)):w("",!0)]),n("div",lt,[n("span",it,g(o.qty)+g(o.unit?" "+o.unit:""),1),t.showPrice&&o.price!=null?(b(),h(U,{key:0},[l[0]||(l[0]=n("span",{class:"ui-items-op"},"×",-1)),n("span",rt,"¥"+g(c(o.price)),1),l[1]||(l[1]=n("span",{class:"ui-items-op"},"=",-1)),a(o)?(b(),h("span",pt,g(o.note),1)):w("",!0),n("b",dt,"¥"+g(c(o.amount??(o.qty||0)*(o.price||0))),1)],64)):w("",!0),o.note&&!a(o)?(b(),h("span",ct,g(o.note),1)):w("",!0)])]))),128)),t.items.length?w("",!0):(b(),h("li",ut,g(t.emptyText),1))]),t.items.length&&t.showTotal?(b(),h("div",mt,[l[2]||(l[2]=n("span",null,"合计",-1)),n("span",ft,g(f.value)+" "+g(t.qtyUnit),1),t.showPrice?(b(),h("b",gt,"¥"+g(c(d.value)),1)):w("",!0)])):w("",!0)]))}}),re=Q(bt,[["__scopeId","data-v-e6f639e0"]]);function ht(t,e="打印"){const a=window.open("","_blank","width=900,height=1200");return a?(a.document.open(),a.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${vt(e)}</title><style>@page { size: A4; margin: 14mm; } body { margin: 0; }</style></head><body>${t}</body></html>`),a.document.close(),a.focus(),a.print(),!0):!1}function yt(t){const e=t==null?void 0:t.contentWindow;if(!e||typeof e.print!="function")return!1;try{return e.focus(),e.print(),!0}catch{return!1}}function vt(t){return t.replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}const xt={A5:{base:"11px",co:"16px",title:"13px"},A4:{base:"12.5px",co:"19px",title:"15px"}};function wt(t){const e=D[t],a=xt[t];return`
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
    font-size: ${a.base};
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
  .hd-co { font-size: ${a.co}; font-weight: 700; letter-spacing: 2px; color: #1a365d; margin: 0; justify-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hd-title { font-size: ${a.title}; font-weight: 600; letter-spacing: 6px; margin: 0; color: #1a365d; justify-self: center; white-space: nowrap; }
  .hd-sub { font-size: ${a.base}; color: #64748b; margin: 2px 0 0; }
  .hd-info { font-size: ${a.base}; color: #64748b; margin: 2px 0 0; }

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
`}function $t(){const t=M();if(t.companyName.trim())return t.companyName.trim();try{const e=localStorage.getItem("erp_company");if(e){const a=JSON.parse(e);if(a&&typeof a.name=="string"&&a.name.trim())return a.name.trim()}}catch{}return"家电批发"}function u(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function j(t){return(Number.isFinite(t)?t:0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}function kt(t,e,a={first:3,last:4}){if(!t.length)return[[]];const c=Math.max(3,e-a.first),f=Math.max(3,e-a.last);if(t.length<=c)return[t];const d=[];let i=0;for(;i<t.length;){const l=t.length-i;if(d.length===0){if(l<=c){d.push(t.slice(i));break}d.push(t.slice(i,i+c)),i+=c;continue}if(l<=f){d.push(t.slice(i));break}if(l>e){let y=e;const k=l-e;k>=1&&k<=2&&(y=e-(3-k)),d.push(t.slice(i,i+y)),i+=y;continue}const m=Math.max(l-f,Math.ceil(l/2));d.push(t.slice(i,i+m)),i+=m}return d}const Pt=["qty","price","amount"],v={no:"c-no",name:"",category:"c-cat",model:"",unit:"c-unit",qty:"num c-qty",price:"num c-price",amount:"num c-amt"};function Nt(t,e){return t.columns.filter(a=>a.on&&(e||a.key!=="price"&&a.key!=="amount"))}function _t(t){return t.map(e=>`<th class="${v[e.key]}">${u(e.label)}</th>`).join("")}function Ct(t,e,a){return`<tr>${t.map(f=>{switch(f.key){case"no":return`<td class="${v.no}">${a}</td>`;case"name":return`<td>${u(e.brand||e.productName)}</td>`;case"category":return`<td class="${v.category}">${u(e.category)}</td>`;case"model":return`<td>${u(e.model)}</td>`;case"unit":return`<td class="${v.unit}">${u(e.unit)}</td>`;case"qty":return`<td class="${v.qty}">${e.quantity}</td>`;case"price":return e.isGift?`<td class="${v.price}">—</td>`:`<td class="${v.price}">${j(e.price)}</td>`;case"amount":return e.isGift?`<td class="${v.amount}">赠品</td>`:`<td class="${v.amount}">${j(e.subtotal)}</td>`;default:return"<td></td>"}}).join("")}</tr>`}function St(t,e,a){const c=t.findIndex(l=>Pt.includes(l.key)),f=c>0?c:t.length,d=t.slice(f);if(!d.length)return`<tfoot><tr><td colspan="${Math.max(1,f)}" class="total-label">合计（数量 ${e.totalQuantity}${a?`　金额 ¥${j(e.totalAmount)}`:""}）</td></tr></tfoot>`;const i=d.map(l=>l.key==="qty"?`<td class="${v.qty}">${e.totalQuantity}</td>`:l.key==="price"?`<td class="${v.price}"></td>`:l.key==="amount"?`<td class="${v.amount}">¥${j(e.totalAmount)}</td>`:"<td></td>").join("");return`<tfoot><tr><td colspan="${f}" class="total-label">合计</td>${i}</tr></tfoot>`}function At(t,e,a){const{showPrice:c,pageNo:f,pageCount:d,startNo:i,isFirst:l,isLast:o,settings:m}=a,y=Nt(m,c),k=Math.max(1,y.length),C=e.length?e.map((p,s)=>Ct(y,p,i+s)).join(""):`<tr><td colspan="${k}" style="text-align:center;color:#94a3b8;padding:14px;">无明细</td></tr>`,z=o?St(y,t,c):"",S=o&&t.remark?`<div class="remark">备注：${u(t.remark)}</div>`:"",F=t.partyLabel==="供应商"?["制单人","采购主管","供应商确认"]:["制单人","仓库发货","客户签收"],L=o&&m.showSign?`<div class="sign">${F.map(p=>`<span class="s">${p}：<span class="line"></span></span>`).join("")}</div>`:"",A=`<div class="pno">第 ${f} / ${d} 页</div>`,q=l?`<div class="party"><div class="party-grid">
         <span class="f"><i>${u(t.partyLabel)}</i>${u(t.partyName)||"—"}</span>
         ${t.partyContact?`<span class="f"><i>联系人</i>${u(t.partyContact)}</span>`:""}
         ${t.partyPhone?`<span class="f"><i>电话</i>${u(t.partyPhone)}</span>`:""}
         ${t.partyAddress?`<span class="f"><i>地址</i>${u(t.partyAddress)}</span>`:""}
       </div></div>`:"",E=[m.companyAddress,m.companyPhone].filter(Boolean).map(u).join("　");return`<section class="page">
    <div class="hd">
      <div class="hd-row">
        <span class="hd-co">${u(m.companyName.trim()||t.companyName||$t())} <span class="hd-date">${u(t.date)}</span></span>
        <span class="hd-title">${u(t.title)}</span>
        <span class="hd-ono">单号：<b>${u(t.orderNo)}</b></span>
      </div>
      ${m.subtitle?`<p class="hd-sub">${u(m.subtitle)}</p>`:""}
      ${E?`<p class="hd-info">${E}</p>`:""}
    </div>

    <div class="meta">
      ${t.operatorName?`<span>制单：<b>${u(t.operatorName)}</b></span>`:""}
    </div>

    ${q}

    <table>
      <thead><tr>${_t(y)}</tr></thead>
      <tbody>${C}</tbody>
      ${z}
    </table>

    ${S}
    ${L}

    <div class="foot">${u(m.footNote)}</div>
    ${A}
  </section>`}function qt(t,e,a=M()){const c=J(a),f=kt(t.items,c,X[a.paper]),d=f.length;let i=1;const l=f.map((o,m)=>{const y=At(t,o,{showPrice:e,pageNo:m+1,pageCount:d,startNo:i,isFirst:m===0,isLast:m===d-1,settings:a});return i+=o.length,y}).join(`
`);return`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${u(t.title)} ${u(t.orderNo)}</title>
<style>${wt(a.paper)}</style>
</head>
<body>
${l}
</body>
</html>`}const Et={key:0,class:"pp-mask"},Ut=["aria-label"],Vt={class:"pp-head"},Mt={class:"pp-title"},jt={class:"pp-head-right"},zt={class:"pp-field inline"},Ft=["value"],Lt={key:0,class:"pp-editor"},Tt={class:"pp-edit-grid"},Ht={class:"pp-field"},Bt={class:"pp-field"},Dt={class:"pp-field"},Ot={class:"pp-field"},It={class:"pp-field wide"},Rt={class:"pp-field"},Qt={class:"pp-check"},Yt={class:"pp-cols"},Gt={class:"pp-col-on"},Kt=["onUpdate:modelValue"],Wt=["onUpdate:modelValue"],Jt={class:"pp-col-move"},Xt=["disabled","onClick"],Zt=["disabled","onClick"],te={class:"pp-body"},ee=["srcdoc","title"],ne={class:"pp-foot"},oe={key:0,class:"pp-toggle"},se=R({__name:"PrintPreview",props:{visible:{type:Boolean},title:{},html:{default:""},orderData:{default:null},allowPriceToggle:{type:Boolean,default:!0},showPrice:{type:Boolean,default:!0}},emits:["cancel","print","update:showPrice"],setup(t,{emit:e}){const a=t,c=e,f=_(null),d=_(a.showPrice),i=_(!1),l=_(M()),o=_({...l.value}),m=Object.keys(D).map(p=>({value:p,label:D[p].label})),y=V({get:()=>l.value.paper,set:p=>{l.value.paper=p,o.value.rowsPerPage||(l.value.rowsPerPage=0),I(l.value)}}),k=V(()=>a.orderData?qt(a.orderData,d.value,l.value):a.html);T(()=>a.showPrice,p=>{d.value=p}),T(d,p=>c("update:showPrice",p)),T(()=>a.visible,p=>{p&&(l.value=M(),o.value=C(l.value),i.value=!1)});function C(p){return{...p,columns:p.columns.map(s=>({...s}))}}function z(){i.value=!i.value,i.value&&(o.value=C(l.value))}function S(p,s){const r=o.value.columns,$=p+s;if($<0||$>=r.length)return;const P=r[p];r[p]=r[$],r[$]=P}function F(){const p={...l.value,companyName:o.value.companyName,subtitle:o.value.subtitle,companyAddress:o.value.companyAddress,companyPhone:o.value.companyPhone,footNote:o.value.footNote,showSign:o.value.showSign,rowsPerPage:Number.isFinite(o.value.rowsPerPage)&&o.value.rowsPerPage>0?Math.floor(o.value.rowsPerPage):0,columns:o.value.columns.map(s=>({key:s.key,label:String(s.label??"").trim()||s.label,on:s.on!==!1}))};l.value=p,I(p),i.value=!1}function L(){const p=Z();o.value={...p,paper:l.value.paper,rowsPerPage:l.value.rowsPerPage}}function A(){c("cancel")}function q(p){p.key==="Escape"&&a.visible&&A()}Y(()=>window.addEventListener("keydown",q)),G(()=>window.removeEventListener("keydown",q));function E(){yt(f.value)||ht(k.value,a.title),c("print")}return(p,s)=>t.visible?(b(),h("div",Et,[n("div",{class:"pp-dialog",role:"dialog","aria-modal":"true","aria-label":t.title},[n("div",Vt,[n("span",Mt,g(t.title),1),n("div",jt,[n("label",zt,[s[9]||(s[9]=n("span",null,"纸张",-1)),x(n("select",{"onUpdate:modelValue":s[0]||(s[0]=r=>y.value=r),class:"pp-select"},[(b(!0),h(U,null,B(W(m),r=>(b(),h("option",{key:r.value,value:r.value},g(r.label),9,Ft))),128))],512),[[K,y.value]])]),n("button",{class:"pp-btn-mini",type:"button",onClick:z},g(i.value?"收起表头设置":"⚙ 表头设置"),1)])]),i.value?(b(),h("div",Lt,[n("div",Tt,[n("label",Ht,[s[10]||(s[10]=n("span",null,"公司抬头",-1)),x(n("input",{"onUpdate:modelValue":s[1]||(s[1]=r=>o.value.companyName=r),type:"text",placeholder:"如：某某家电批发"},null,512),[[N,o.value.companyName]])]),n("label",Bt,[s[11]||(s[11]=n("span",null,"副标题",-1)),x(n("input",{"onUpdate:modelValue":s[2]||(s[2]=r=>o.value.subtitle=r),type:"text",placeholder:"如：送货凭证 / 出库单"},null,512),[[N,o.value.subtitle]])]),n("label",Dt,[s[12]||(s[12]=n("span",null,"公司地址",-1)),x(n("input",{"onUpdate:modelValue":s[3]||(s[3]=r=>o.value.companyAddress=r),type:"text",placeholder:"选填"},null,512),[[N,o.value.companyAddress]])]),n("label",Ot,[s[13]||(s[13]=n("span",null,"公司电话",-1)),x(n("input",{"onUpdate:modelValue":s[4]||(s[4]=r=>o.value.companyPhone=r),type:"text",placeholder:"选填"},null,512),[[N,o.value.companyPhone]])]),n("label",It,[s[14]||(s[14]=n("span",null,"页脚文字",-1)),x(n("input",{"onUpdate:modelValue":s[5]||(s[5]=r=>o.value.footNote=r),type:"text",placeholder:"选填"},null,512),[[N,o.value.footNote]])]),n("label",Rt,[s[15]||(s[15]=n("span",null,"每页行数",-1)),x(n("input",{"onUpdate:modelValue":s[6]||(s[6]=r=>o.value.rowsPerPage=r),type:"number",min:"0",placeholder:"0 = 按纸张自动"},null,512),[[N,o.value.rowsPerPage,void 0,{number:!0}]])]),n("label",Qt,[x(n("input",{"onUpdate:modelValue":s[7]||(s[7]=r=>o.value.showSign=r),type:"checkbox"},null,512),[[H,o.value.showSign]]),s[16]||(s[16]=O(" 显示签章栏 ",-1))])]),n("div",Yt,[s[17]||(s[17]=n("div",{class:"pp-cols-title"},"明细表字段（勾选 / 改名 / 调顺序）",-1)),(b(!0),h(U,null,B(o.value.columns,(r,$)=>(b(),h("div",{key:r.key,class:"pp-col-row"},[n("label",Gt,[x(n("input",{"onUpdate:modelValue":P=>r.on=P,type:"checkbox"},null,8,Kt),[[H,r.on]])]),x(n("input",{"onUpdate:modelValue":P=>r.label=P,class:"pp-col-label",type:"text"},null,8,Wt),[[N,r.label]]),n("div",Jt,[n("button",{class:"pp-btn-mini tiny",type:"button",disabled:$===0,onClick:P=>S($,-1)},"↑",8,Xt),n("button",{class:"pp-btn-mini tiny",type:"button",disabled:$===o.value.columns.length-1,onClick:P=>S($,1)},"↓",8,Zt)])]))),128))]),n("div",{class:"pp-edit-actions"},[n("button",{class:"pp-btn-mini",type:"button",onClick:L},"恢复默认"),n("button",{class:"pp-btn-mini primary",type:"button",onClick:F},"保存表头")])])):w("",!0),n("div",te,[n("iframe",{ref_key:"frameEl",ref:f,class:"pp-frame",srcdoc:k.value,title:t.title},null,8,ee)]),n("div",ne,[t.allowPriceToggle?(b(),h("label",oe,[x(n("input",{"onUpdate:modelValue":s[8]||(s[8]=r=>d.value=r),type:"checkbox"},null,512),[[H,d.value]]),s[18]||(s[18]=O(" 打印含单价 ",-1))])):w("",!0),n("div",{class:"pp-btns"},[n("button",{class:"pp-btn ghost btn-cancel",type:"button",onClick:A},"取消"),n("button",{class:"pp-btn primary btn-print",type:"button",onClick:E},"🖨 打印")])])],8,Ut)])):w("",!0)}}),pe=Q(se,[["__scopeId","data-v-e5770a01"]]);export{re as I,pe as P,qt as b,$t as g};

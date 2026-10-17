"use client";

import type { CatalogProduct, CatalogProductListResponse, CatalogStoreOffer, CatalogStoreOfferListResponse, CatalogStoreOfferResponse, CatalogProductResponse, CreateStoreOfferRequest, UpdateStoreOfferRequest, MediaProvenanceInput } from "@bthwani/dsh";
import { isMediaProvenanceInputValid } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appendMediaProvenance, CatalogMediaProvenanceFields } from "../central-catalog/catalog-media-provenance-fields";
import { StoreCatalogImportWorkspace } from "../central-catalog/store-catalog-import-workspace";

type Mode = "shared" | "local";
type Attempt = { productKey: string; offerKey: string; correlation: string; fingerprint: string };
type ProductVariantOption = { value: string; name: string; kind: "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE"; unit: string };

const money = (amount: number) => new Intl.NumberFormat("ar-YE").format(amount) + " ر.ي";
function createInput(variantId: string, priceMinor: number, kind: CreateStoreOfferRequest["quantityPolicy"]): CreateStoreOfferRequest {
  const discrete = kind === "DISCRETE";
  return { variantId, priceMinor, quantityPolicy:kind, quantityMinBaseUnits:1,
    quantityMaxBaseUnits:discrete ? 100 : 100000, quantityStepBaseUnits:1,
    pricingBasis:discrete ? "PER_UNIT" : "PER_MEASURE", pricingUnitBaseUnits:discrete ? 1 : 1000,
    inventoryPolicy:"AVAILABILITY_ONLY",inventoryOnHandBaseUnits:0 };
}
async function payload<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if(!response.ok) throw new Error(typeof data?.error?.message === "string" ? data.error.message : "تعذر تنفيذ العملية. تحقق من البيانات وحاول مجددًا.");
  return data as T;
}
function inputPrice(s: string): number {
  const num = Number(s.trim());
  return /^\d+$/.test(s.trim()) && Number.isSafeInteger(num) && num>0 ? num : 0;
}
export function StoreProductsWorkspace({storeId, verticalId,storeName}:{storeId:string;verticalId:string|null;storeName:string}) {
  const [offers,setOffers]=useState<ReadonlyArray<CatalogStoreOffer>>([]);
  const [cursor,setCursor]=useState("");
  const [back,setBack]=useState<ReadonlyArray<string>>([]);
  const [nextCursor,setNextCursor]=useState("");
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [mode,setMode]=useState<Mode>("shared");
  const [openAdd,setOpenAdd]=useState(false);
  const [search,setSearch]=useState("");
  const [appliedSearch,setAppliedSearch]=useState("");
  const [shared,setShared]=useState<ReadonlyArray<CatalogProduct>>([]);
  const [sharedCursor,setSharedCursor]=useState("");
  const [sharedLoading,setSharedLoading]=useState(false);
  const [selection,setSelection]=useState("");
  const [newName,setNewName]=useState("");
  const [newDescription,setNewDescription]=useState("");
  const [unitKind,setUnitKind]=useState<"DISCRETE"|"MEASURED">("DISCRETE");
  const [newUnit,setNewUnit]=useState<"GRAM"|"MILLILITER">("GRAM");
  const [price,setPrice]=useState("");
  const [editing,setEditing]=useState<CatalogStoreOffer|null>(null);
  const [productDetails,setProductDetails]=useState<CatalogProduct|null>(null);
  const [detailsLoading,setDetailsLoading]=useState(false);
  const [nameDraft,setNameDraft]=useState("");
  const [descriptionDraft,setDescriptionDraft]=useState("");
  const [productAttempt,setProductAttempt]=useState<{key:string;fingerprint:string}|null>(null);
  const [photo,setPhoto]=useState<File|null>(null);
  const [mediaAttempt,setMediaAttempt]=useState<string|null>(null);
  const [provenance,setProvenance]=useState<MediaProvenanceInput>({creator:"",sourceDescription:"",rightsStatement:"",rightsAttested:false});
  const [editPrice,setEditPrice]=useState("");
  const [editAvailable,setEditAvailable]=useState(true);
  const [editState,setEditState]=useState<"draft"|"published"|"hidden">("draft");
  const [busy,setBusy]=useState(false);
  const [attempt,setAttempt]=useState<Attempt|null>(null);
  const [editAttempt,setEditAttempt]=useState<{key:string;fingerprint:string}|null>(null);
  const [importOpen,setImportOpen]=useState(false);
  const load = useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);
    try {
      const params=new URLSearchParams({limit:"30",cursor});
      const value=await payload<CatalogStoreOfferListResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/offers?"+params,{cache:"no-store",...(signal?{signal}:{})}));
      if(value.offers.some(o=>o.storeId!==storeId))throw new Error("استجابة منتجات المتجر غير متطابقة.");
      setOffers(value.offers);setNextCursor(value.nextCursor??"");setError("");
    } catch(e) { if(!signal?.aborted)setError(e instanceof Error?e.message:"تعذر تحميل المنتجات."); }
    finally{if(!signal?.aborted)setLoading(false)}
  },[storeId,cursor]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return ()=>controller.abort()},[load,refresh]);

  const find = useCallback(async(q:string,append=false,cursorValue="")=>{
    setSharedLoading(true);setError("");
    try{
      const params=new URLSearchParams({q:q.trim(),cursor:cursorValue});
      const value=await payload<CatalogProductListResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/products?"+params,{cache:"no-store"}));
      setShared(current=>append?[...current,...value.products]:value.products);
      setSharedCursor(value.nextCursor??"");
    } catch(e){setError(e instanceof Error?e.message:"تعذر البحث في المنتجات المشتركة")}
    finally{setSharedLoading(false)}
  },[storeId]);
  useEffect(()=>{if(openAdd&&mode==="shared"&&shared.length===0&&!appliedSearch){void find("")}},[openAdd,mode,shared.length,appliedSearch,find]);

  const variants=useMemo<ProductVariantOption[]>(()=>shared.flatMap(product=>product.variants.filter(v=>v.active).map(v=>({value:v.id,name:product.canonicalName+" — "+v.title,kind:v.measurementKind,unit:v.baseUnit}))),[shared]);
  const chosen=variants.find(v=>v.value===selection);
  const fingerprint=mode==="shared" ? [mode,selection,price].join(":") : [mode,newName,newDescription,unitKind,newUnit,price].join(":");
  async function createOffer() {
    const amount=inputPrice(price);
    if(!amount||busy||(mode==="shared"&&!chosen)||(mode==="local"&&(!newName.trim()||!verticalId)))return;
    const current=attempt?.fingerprint===fingerprint?attempt:{productKey:crypto.randomUUID(),offerKey:crypto.randomUUID(),correlation:crypto.randomUUID(),fingerprint};
    setAttempt(current);setBusy(true);setError("");setNotice("");
    try {
      let variantId=chosen?.value??"";
      let kind:CreateStoreOfferRequest["quantityPolicy"]=chosen?.kind??unitKind;
      if(mode==="local"){
        const product=await payload<CatalogProductResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/products",{
          method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":current.productKey,"X-Correlation-ID":current.correlation},
          body:JSON.stringify({scope:"STORE_SCOPED",storeId,verticalId,canonicalName:newName.trim(),description:newDescription.trim(),variantTitle:"الافتراضي",measurementKind:unitKind,baseUnit:unitKind==="DISCRETE"?"COUNT":newUnit})
        }));
        variantId=product.product.variants[0]?.id??"";
        if(!variantId)throw new Error("تم إنشاء المنتج لكن لم تتوفر نسخته. أعد المحاولة لاستكمال عرضه.");
        kind=unitKind;
      }
      await payload<CatalogStoreOfferResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/offers",{
        method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":current.offerKey,"X-Correlation-ID":current.correlation},
        body:JSON.stringify(createInput(variantId,amount,kind))
      }));
      setNotice("تم حفظ المنتج في المتجر كمسودة. يمكن نشر العرض بعد استكمال بياناته.");
      setPrice("");setNewName("");setNewDescription("");setSelection("");setOpenAdd(false);setAttempt(null);
      setCursor("");setBack([]);setRefresh(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"تعذرت إضافة المنتج. يمكن إعادة المحاولة دون تكرار العملية.");}
    finally{setBusy(false)}
  }
  async function readProduct(offer:CatalogStoreOffer) {
    setDetailsLoading(true);
    try {
      const data=await payload<CatalogProduct>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/products/"+encodeURIComponent(offer.productId),{cache:"no-store"}));
      setProductDetails(data);setNameDraft(data.canonicalName);setDescriptionDraft(data.description??"");
    }catch(e){setError(e instanceof Error?e.message:"تعذر قراءة بيانات المنتج.");}
    finally{setDetailsLoading(false)}
  }
  function startEdit(offer:CatalogStoreOffer){
    setEditing(offer);setProductDetails(null);setPhoto(null);setMediaAttempt(null);setProductAttempt(null);void readProduct(offer);setEditPrice(String(offer.priceMinor));setEditAvailable(offer.availability);
    setEditState(offer.publicationState);setError("");setNotice("");setEditAttempt(null);
  }
  async function saveProduct() {
    if(!productDetails||productDetails.scope!=="STORE_SCOPED"||!editing||busy)return;
    const name=nameDraft.trim();if(!name)return;
    const fingerprint=[productDetails.id,productDetails.version,name,descriptionDraft].join(":");
    const current=productAttempt?.fingerprint===fingerprint?productAttempt:{key:crypto.randomUUID(),fingerprint};
    setProductAttempt(current);setBusy(true);setError("");
    try {
      const input={canonicalName:name,description:descriptionDraft,verticalId:productDetails.verticalId??verticalId??"",scope:"STORE_SCOPED",storeId,active:productDetails.active};
      const data=await payload<CatalogProductResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/products/"+encodeURIComponent(productDetails.id),{
        method:"PATCH",headers:{"Content-Type":"application/json","Idempotency-Key":current.key,"X-Expected-Version":String(productDetails.version)},body:JSON.stringify(input)
      }));
      setProductDetails(data.product);setProductAttempt(null);setNotice("حُفظت بيانات المنتج.");setRefresh(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"تعذر تعديل بيانات المنتج.")}
    finally{setBusy(false)}
  }
  async function uploadPhoto() {
    if(!productDetails||productDetails.scope!=="STORE_SCOPED"||!photo||busy||!isMediaProvenanceInputValid(provenance))return;
    const key=mediaAttempt??crypto.randomUUID();setMediaAttempt(key);setBusy(true);setError("");
    try{
      const form=new FormData();form.set("role","primary");form.set("file",photo,photo.name);appendMediaProvenance(form,provenance);
      const data=await payload<CatalogProductResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/products/"+encodeURIComponent(productDetails.id)+"/media",{
        method:"POST",headers:{"Idempotency-Key":key,"X-Expected-Version":String(productDetails.version)},body:form
      }));
      setProductDetails(data.product);setMediaAttempt(null);setPhoto(null);setNotice("حُفظت صورة المنتج.");setRefresh(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"تعذر رفع الصورة.")}
    finally{setBusy(false)}
  }
  async function saveEdit(){
    if(!editing||busy)return;
    const amount=inputPrice(editPrice);if(!amount)return;
    const fingerprint=[editing.offerId,editing.version,amount,editAvailable,editState].join(":");
    const current=editAttempt?.fingerprint===fingerprint?editAttempt:{key:crypto.randomUUID(),fingerprint};
    setEditAttempt(current);setBusy(true);setError("");
    const input:UpdateStoreOfferRequest={
      priceMinor:amount,availability:editAvailable,publicationState:editState,
      quantityPolicy:editing.quantityPolicy,quantityMinBaseUnits:editing.quantityMinBaseUnits,
      quantityMaxBaseUnits:editing.quantityMaxBaseUnits,quantityStepBaseUnits:editing.quantityStepBaseUnits,
      pricingBasis:editing.pricingBasis,pricingUnitBaseUnits:editing.pricingUnitBaseUnits,
      inventoryPolicy:editing.inventoryPolicy,inventoryOnHandBaseUnits:editing.inventoryOnHandBaseUnits
    };
    try {
      await payload<CatalogStoreOfferResponse>(await fetch("/api/stores/"+encodeURIComponent(storeId)+"/offers/"+encodeURIComponent(editing.offerId),{
        method:"PATCH",headers:{"Content-Type":"application/json","Idempotency-Key":current.key,"X-Expected-Version":String(editing.version)},
        body:JSON.stringify(input)
      }));
      setEditing(null);setEditAttempt(null);setNotice("حُفظت تعديلات المنتج في المتجر.");setRefresh(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"تعذر حفظ التعديل. حدّث القائمة عند تعارض النسخة.");}
    finally{setBusy(false)}
  }
  return <section className="store-product-management" aria-label={"إدارة منتجات "+storeName}>
    <div className="store-product-toolbar">
      <div><h3>منتجات المتجر</h3><p className="store-profile-muted">أضف المنتجات وعدّل أسعارها وتوفرها دون مغادرة ملف المتجر.</p></div>
      <div className="store-product-actions">
        <button type="button" className="button button-secondary" onClick={()=>{setImportOpen(!importOpen);setOpenAdd(false)}}>{importOpen?"إغلاق الاستيراد":"استيراد ملف"}</button>
        <button type="button" className="button button-primary" onClick={()=>{setOpenAdd(!openAdd);setImportOpen(false);setError("");setNotice("")}}>{openAdd?"إغلاق الإضافة":"إضافة منتج"}</button>
      </div>
    </div>
    {notice?<p role="status" className="success-inline">{notice}</p>:null}
    {error?<p role="alert" className="identity-error">{error}<button type="button" className="button button-quiet" onClick={()=>{setRefresh(v=>v+1);setError("")}}>تحديث</button></p>:null}
    {openAdd?<div className="store-product-editor" aria-label="إضافة منتج">
      <div className="store-product-mode" role="group" aria-label="مصدر المنتج">
        <button className={"button "+(mode==="shared"?"button-primary":"button-secondary")} type="button" disabled={busy} onClick={()=>{setMode("shared");setAttempt(null)}}>اختيار منتج موجود</button>
        <button className={"button "+(mode==="local"?"button-primary":"button-secondary")} type="button" disabled={busy} onClick={()=>{setMode("local");setAttempt(null)}}>إنشاء منتج للمتجر</button>
      </div>
      {mode==="shared"?<>
        <form onSubmit={e=>{e.preventDefault();setAppliedSearch(search);setSelection("");void find(search)}} className="store-product-search">
          <label>بحث بالاسم<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="اسم المنتج في الكتالوج المشترك" maxLength={160} disabled={busy}/></label>
          <button className="button button-secondary" type="submit" disabled={sharedLoading||busy}>بحث</button>
        </form>
        <label>المنتج والنسخة
          <select value={selection} onChange={e=>setSelection(e.target.value)} disabled={busy||sharedLoading}>
            <option value="">اختر المنتج</option>
            {variants.map(v=><option key={v.value} value={v.value}>{v.name} ({v.unit})</option>)}
          </select>
        </label>
        {sharedLoading?<p role="status">جارٍ البحث…</p>:variants.length===0?<p className="store-profile-muted">لم تُعثر على منتجات مطابقة. يمكنك إنشاء منتج خاص بهذا المتجر.</p>:null}
        {sharedCursor?<button className="button button-quiet" type="button" disabled={sharedLoading} onClick={()=>void find(appliedSearch,true,sharedCursor)}>المزيد من المنتجات</button>:null}
      </>:<>
        <label>اسم المنتج<input value={newName} maxLength={160} disabled={busy} onChange={e=>setNewName(e.target.value)}/></label>
        <label>الوصف (اختياري)<input value={newDescription} maxLength={4000} disabled={busy} onChange={e=>setNewDescription(e.target.value)}/></label>
        <label>نوع المنتج
          <select value={unitKind} disabled={busy} onChange={e=>setUnitKind(e.target.value as "DISCRETE"|"MEASURED")}>
            <option value="DISCRETE">بالقطعة</option><option value="MEASURED">بالوزن أو الحجم</option>
          </select>
        </label>
        {unitKind==="MEASURED"?<label>الوحدة <select value={newUnit} disabled={busy} onChange={e=>setNewUnit(e.target.value as "GRAM"|"MILLILITER")}><option value="GRAM">جرام</option><option value="MILLILITER">ملليلتر</option></select></label>:null}
      </>}
      <label>السعر بالريال اليمني<input type="number" min="1" step="1" inputMode="numeric" value={price} disabled={busy} onChange={e=>setPrice(e.target.value)}/></label>
      <div className="store-product-actions"><button className="button button-primary" type="button" disabled={busy||!inputPrice(price)||(mode==="shared"?!chosen:!newName.trim()||!verticalId)} onClick={()=>void createOffer()}>{busy?"جارٍ الحفظ…":"حفظ المنتج"}</button></div>
    </div>:null}
    {importOpen?<StoreCatalogImportWorkspace fixedStore={{id:storeId,name:storeName}} onImported={()=>setRefresh(v=>v+1)}/>:null}
    {editing?<div className="store-product-editor" aria-label={"تعديل "+editing.productName}>
      <div className="store-product-toolbar"><strong>{editing.productName} — {editing.variantTitle}</strong><button className="button button-quiet" type="button" disabled={busy} onClick={()=>setEditing(null)}>إلغاء</button></div>
      <label>السعر<input type="number" min="1" step="1" value={editPrice} disabled={busy} onChange={e=>setEditPrice(e.target.value)}/></label>
      <label className="store-product-check"><input type="checkbox" checked={editAvailable} disabled={busy} onChange={e=>setEditAvailable(e.target.checked)}/> متاح للطلب</label>
      <label>حالة العرض <select disabled={busy} value={editState} onChange={e=>setEditState(e.target.value as typeof editState)}><option value="draft">مسودة</option><option value="published">منشور</option><option value="hidden">مخفي</option></select></label>
      <button className="button button-primary" disabled={busy||!inputPrice(editPrice)} type="button" onClick={()=>void saveEdit()}>{busy?"جارٍ الحفظ…":"حفظ السعر والتوفر"}</button>
      {detailsLoading?<p role="status">جارٍ تحميل تفاصيل المنتج…</p>:null}
      {productDetails?.id===editing.productId?productDetails.scope==="STORE_SCOPED"?<div className="store-product-local-editor">
        <h4>بيانات المنتج الخاص بالمتجر</h4>
        <label>اسم المنتج<input value={nameDraft} maxLength={160} disabled={busy} onChange={e=>setNameDraft(e.target.value)} /></label>
        <label>الوصف<input value={descriptionDraft} maxLength={4000} disabled={busy} onChange={e=>setDescriptionDraft(e.target.value)} /></label>
        <button className="button button-secondary" type="button" disabled={busy||!nameDraft.trim()} onClick={()=>void saveProduct()}>حفظ بيانات المنتج</button>
        <label>صورة المنتج (JPEG أو PNG)<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e=>{setPhoto(e.target.files?.[0]??null);setMediaAttempt(null)}} /></label>
        {photo?<><CatalogMediaProvenanceFields compact idPrefix={"product-media-"+editing.offerId} disabled={busy} value={provenance} onChange={setProvenance}/>
          <button type="button" className="button button-secondary" disabled={busy||photo.size>10*1024*1024||!isMediaProvenanceInputValid(provenance)} onClick={()=>void uploadPhoto()}>رفع صورة المنتج</button></>:null}
      </div>:<p className="store-profile-muted">هذا منتج مشترك؛ يمكن تعديل سعره وتوفره لهذا المتجر هنا، أما اسمه وصورته المشتركة فتداران من الكتالوج المركزي.</p>:null}
    </div>:null}
    {loading?<p role="status" className="store-profile-muted">جارٍ تحميل المنتجات…</p>:null}
    {!loading&&offers.length===0?<p className="store-profile-empty">لا توجد عروض منتجات لهذا المتجر. استخدم «إضافة منتج» للبدء.</p>:null}
    {!loading&&offers.length>0?<div className="store-product-list">
      {offers.map(o=><article className="store-product-row" key={o.offerId}>
        {o.media[0]?.uri?<img src={o.media[0].uri} alt="" loading="lazy"/>:<div className="store-product-placeholder" aria-hidden="true">▣</div>}
        <div className="store-product-description"><strong>{o.productName}</strong><span>{o.variantTitle} · {money(o.priceMinor)}</span><span>{o.publicationState==="published"?"منشور":o.publicationState==="hidden"?"مخفي":"مسودة"} · {o.availability?"متاح":"غير متاح"}</span></div>
        <button type="button" className="button button-secondary" disabled={busy} onClick={()=>startEdit(o)}>تعديل</button>
      </article>)}
    </div>:null}
    {nextCursor||back.length?<nav className="store-product-actions" aria-label="صفحات المنتجات">
      <button type="button" className="button button-secondary" disabled={loading||!back.length} onClick={()=>{setCursor(back[back.length-1]??"");setBack(b=>b.slice(0,-1))}}>السابق</button>
      <button type="button" className="button button-secondary" disabled={loading||!nextCursor} onClick={()=>{setBack(b=>[...b,cursor]);setCursor(nextCursor)}}>التالي</button>
    </nav>:null}
  </section>;
}

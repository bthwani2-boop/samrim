import assert from "node:assert/strict";
import { test } from "node:test";
import { createRadioGroup } from "../src/radio-group.ts";

function fixture(values, selected, { web = true, disabled = false, canSelect = () => true } = {}) {
  const calls = [];
  const group = createRadioGroup({ values, selected, web, disabled, canSelect, onSelect: (...args) => calls.push(args) });
  const document = { activeElement: null };
  const hosts = values.map(() => ({ ownerDocument: document, focus() { document.activeElement = this; } }));
  const props = values.map((value, index) => {
    const p = group(value);
    p.ref?.(hosts[index]);
    return p;
  });
  const key = (index, key) => {
    let prevented = false;
    props[index].onKeyDown?.({ nativeEvent: { key }, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { group, calls, props, hosts, document, key };
}
test("web radio groups have one tab stop and wrap arrow selection", () => {
  const f = fixture(["a", "b", "c"], "b");
  assert.deepEqual(f.props.map(p => p.tabIndex), [-1, 0, -1]);
  assert.deepEqual(f.props.map(p => p["aria-checked"]), [false, true, false]);
  for (const [index, key, target] of [[1,"ArrowRight",2],[2,"ArrowDown",0],[0,"ArrowLeft",2],[0,"ArrowUp",2]]) {
    assert.equal(f.key(index,key),true);
    assert.equal(f.document.activeElement,f.hosts[target]);
    assert.deepEqual(f.calls.at(-1), [["a","b","c"][target],{target:f.hosts[target],previous:f.hosts[1]}]);
  }
  assert.equal(f.key(1,"Tab"),false);
  assert.equal(f.key(1," "),false);
  f.props[0].onPress();
  assert.deepEqual(f.calls.at(-1),["a"]);
});
test("unanswered, missing, empty, singleton and undefined options preserve semantics", () => {
  for (const selected of [null,"missing"]) {
    const f = fixture(["a","b"],selected);
    assert.deepEqual(f.props.map(p=>p.tabIndex),[0,-1]);
    assert.deepEqual(f.props.map(p=>p.accessibilityState.checked),[false,false]);
    f.key(0,"ArrowRight");
    assert.equal(f.calls[0][1].previous,undefined);
    const absent=f.group("unknown");
    assert.equal(absent.tabIndex,-1);
    absent.onPress();
    absent.onKeyDown({nativeEvent:{key:"ArrowLeft"},preventDefault(){}});
    assert.equal(f.calls.length,1);
  }
  assert.deepEqual(fixture([],null).props,[]);
  const single=fixture(["one"],"one");
  assert.equal(single.key(0,"ArrowRight"),true);
  assert.deepEqual(single.calls,[]);
  const filter=fixture([undefined,"active"],undefined);
  assert.deepEqual(filter.props.map(p=>p.tabIndex),[0,-1]);
  filter.key(1,"ArrowRight");
  assert.equal(filter.calls[0][0],undefined);
});
test("disabled, revoked and detached targets cannot dispatch", () => {
  let allowed=true;
  const f=fixture(["a","b"],"a",{canSelect:()=>allowed});
  f.props[1].ref(null);
  f.key(0,"ArrowRight");
  f.key(1,"ArrowLeft");
  assert.deepEqual(f.calls,[]);
  f.props[1].ref(f.hosts[1]);
  allowed=false;
  f.key(0,"ArrowRight");
  f.props[1].onPress();
  assert.deepEqual(f.calls,[]);
  const disabled=fixture(["a","b"],"a",{disabled:true});
  assert.deepEqual(disabled.props.map(p=>p.tabIndex),[-1,-1]);
  assert.ok(disabled.props.every(p=>p.disabled && p.accessibilityState.disabled));
  disabled.key(0,"ArrowRight");
  disabled.props[1].onPress();
  assert.deepEqual(disabled.calls,[]);
});
test("native retains radio state without web handlers and groups remain independent", () => {
  const native=fixture([true,false],false,{web:false});
  assert.ok(native.props.every(p=>p.accessibilityRole==="radio" && !("tabIndex" in p) && !("onKeyDown" in p) && !("ref" in p)));
  native.props[0].onPress();
  assert.deepEqual(native.calls,[[true]]);
  const one=fixture(["a","b"],"a"),two=fixture(["a","b"],"b");
  one.key(0,"ArrowRight");
  assert.deepEqual(two.calls,[]);
  assert.equal(two.document.activeElement,null);
});

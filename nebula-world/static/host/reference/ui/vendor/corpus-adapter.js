/* Immutable runtime adapter. No title-based matching, network, prices or writes.
 * Node and browser share this exact file and the same rational core.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./quantity-engine.js'));else root.SmileyCorpus=factory(root.SmileyQuantity);})(typeof globalThis!=='undefined'?globalThis:this,function(E){
'use strict';
const RX=(s,t)=>new RegExp(s,'i').test(t), unique=a=>[...new Set(a)];
const NF='(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)';
const cn=new RegExp('^\\s*('+NF+')(?:\\s*(?:–|—|-|to)\\s*('+NF+'))?\\b','i');
function scalar(v){return E.Rat.from(v);}
function gap(reason,extra={}){return {status:'GAP',quantity:null,reason,trace:[],price:null,...extra};}
function stableStringify(o){if(Array.isArray(o))return '['+o.map(stableStringify).join(',')+']';if(o&&typeof o==='object')return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+stableStringify(o[k])).join(',')+'}';return JSON.stringify(o);}
function sourceIdentity(row){
 const raw=(row.raw||'')+' '+(row.prep||'');let product=row.id;const spec={};
 const sourceForms=['frozen','canned','dried','powdered','fresh','ground','cracked','smoked','salted','unsalted','skim','low-fat','nonfat'];const present=sourceForms.filter(x=>new RegExp('\\b'+x+'\\b','i').test(raw));if(present.length)spec.explicit_form_tags=present.sort().join('|');
 if(['butter','unsalted-butter'].includes(row.id)){spec.salt_state=/\bunsalted\b/i.test(raw)?'unsalted':/\bsalted\b/i.test(raw)?'salted':'unspecified';spec.form=/\bclarified|ghee\b/i.test(raw)?'clarified':/\b(?:brown|browned) butter\b/i.test(raw)?'browned':/\bwhipped\b/i.test(raw)?'whipped':'ordinary';}
 if(['salt','kosher-salt','sea-salt'].includes(row.id)){spec.salt_type=/\bkosher\b/i.test(raw)?'kosher':/\bsea salt\b/i.test(raw)?'sea':/\btable (?:grind )?salt\b/i.test(raw)?'table':'unspecified';spec.brand=/diamond crystal/i.test(raw)?'Diamond Crystal':/morton/i.test(raw)?'Morton':'unspecified';}
 if(['sugar','granulated-sugar','brown-sugar','powdered-sugar'].includes(row.id)){spec.form=/superfine|caster/i.test(raw)?'superfine':/powdered|confectioners/i.test(raw)?'powdered':/brown/i.test(raw)?'brown':/granulated/i.test(raw)?'granulated':'unspecified';spec.packing=/lightly packed/i.test(raw)?'lightly packed':/packed/i.test(raw)?'packed':'unspecified';}
 if(row.id.includes('flour')||row.id==='flour'){spec.flour_type=/self.rising/i.test(raw)?'self-rising':/all.purpose/i.test(raw)?'all-purpose':/bread flour/i.test(raw)?'bread':/cake flour/i.test(raw)?'cake':row.id;spec.method=/unsifted/i.test(raw)?'unsifted':/sifted/i.test(raw)?'sifted':/spooned/i.test(raw)?'spooned':/scoop/i.test(raw)?'scooped':'unspecified';}
 if(row.id==='red-pepper'){spec.form=/bell/i.test(raw)?'bell':/cayenne|ground red pepper/i.test(raw)?'ground-cayenne':/crushed|flakes/i.test(raw)?'crushed-chile':/jarred|roasted/i.test(raw)?'roasted-jarred':'unspecified';}
 if(/tomato/.test(row.id)){spec.form=/paste/i.test(raw)?'paste':/canned|cans?\b|tin(?:ned)?\b/i.test(raw)?'canned':/fresh|tomatoes?|roma/i.test(raw)?'fresh':'unspecified';if(spec.form==='canned')spec.drain_state=/drained/i.test(raw)?'drained':/with (?:their |its )?juice|in juice/i.test(raw)?'with juice':'unspecified';}
 if(row.id==='garlic'){spec.form=/powder/i.test(raw)?'powder':/jarred|in oil|bottled/i.test(raw)?'processed':/cloves?|heads?|bulbs?|fresh|minced|chopped/i.test(raw)?'fresh':'unspecified';}
 if(row.id==='ginger')spec.form=/ground/i.test(raw)?'ground':/fresh|root|grated/i.test(raw)?'fresh':'unspecified';
 if(['lemon-juice','lime-juice','orange-juice'].includes(row.id)){spec.form=/fresh(?:ly)?|squeezed/i.test(raw)?'freshly-extracted':'unspecified-purchased';if(spec.form==='freshly-extracted')product=row.id.replace('-juice','');}
 return {product_id:product,spec,raw};
}
function rawHazard(row){const raw=E.normalizeNumbers(row.raw||'');
 if(/1\s+1\/2 cups all.purpose flour 1 egg/i.test(raw)||/2 tablespoons plus 2 teaspoons cold milk 1\s+1\/8 cups/i.test(raw)||/5 tablespoons unsalted butter, melted 1 small egg/i.test(raw)||/superfine.*sugar squeeze of lemon juice/i.test(raw)||/peeled and chopped tomatoes 2 bay leaves/i.test(raw))return 'QA_CONFIRMED_FUSED_ROW';
 if(/\b(?:as needed|as required|to taste)\b/i.test(raw)&&(!row.qty||row.scaling==='to_taste'))return 'TO_TASTE';
 if(row.id==='pre-hy')return 'ONTOLOGY_UNRESOLVED_PRE_HY';
 return null;
}
function countAmount(row,countUnit){
 const text=E.normalizeNumbers(row.raw||''),m=cn.exec(text);if(!m)return gap('COUNT_TEXT_NOT_UNAMBIGUOUS');
 const doz=/^\s*(?:dozen|doz\b)/i.test(text.slice(m[0].length)), rawV={min:m[1],max:m[2]||m[1]};
 let structured;try{structured=row.qty==null?null:scalar(row.qty);}catch{return gap('INVALID_SOURCE_QUANTITY');}
 if(structured&&structured.cmp(rawV.min)!==0&&!m[2])return gap('STRUCTURED_RAW_QUANTITY_MISMATCH');
 if(!structured&&!m[1])return gap('QUANTITY_MISSING');
 const mult=doz?12:1,q=E.scaleQuantity({...rawV,unit:countUnit},mult,'linear');
 return {status:'PARSED',quantity:q,original_text:row.raw,correction:(m[2]||doz||row.qty==null||!['each'].includes(row.unit))?{kind:doz?'EXPLICIT_DOZEN_TO_QUALIFIED_COUNT':m[2]?'RESTORE_EXPLICIT_COUNT_RANGE':'QUALIFY_SOURCE_COUNT',old:{qty:row.qty,unit:row.unit,unit_raw:row.unit_raw||null},new:q,basis:'Leading source count, explicit part/size; no mass or bulb inference.'}:null};
}
function countSpec(row,config){const t=E.normalizeNumbers((row.raw||'')+' '+(row.prep||''));const size=/extra.large/i.test(t)?'extra-large':/\blarge\b/i.test(t)?'large':/\bmedium\b/i.test(t)?'medium':/\bsmall\b/i.test(t)?'small':/\bjumbo\b/i.test(t)?'jumbo':'size-unspecified';
 if(row.id==='garlic'&&/\bcloves?\b/i.test(t))return {unit:`count:garlic:clove-${size}`,part:'clove',ap:false,size};
 if(row.id==='garlic'&&/\b(?:heads?|bulbs?)\b/i.test(t))return {unit:`count:garlic:whole-bulb-${size}`,part:'bulb',ap:true,size};
 if(['egg-white','egg-yolk'].includes(row.id))return {unit:`count:egg:${row.id.replace('egg-','')}-${size}`,part:row.id,ap:false,size};
 if(['egg','eggs'].includes(row.id)&&/\beggs?\b/i.test(t)&&!/\bwhites?|yolks?\b/i.test(t))return {unit:`count:egg:whole-${size}`,part:'whole',ap:true,size};
 if(config.whole_count_ids.includes(row.id)&&!/^\s*\d.*\b(?:slices?|pieces?|balls?|leaves|stalks?|ribs?|sprigs?|wedges)\b[^,]*(?:of )?/i.test(t.split(',')[0])&&!/\b(?:canned|can |cans |jar|jarred|dried|powder|paste)\b/i.test(t))return {unit:`count:${row.id}:whole-${size}`,part:'whole',ap:true,size};
 if(/\b(?:bunches?|heads?)\b/i.test(t)&&row.unit==='other'){let part=/bunch/i.test(t)?'bunch':'head';return {unit:`count:${row.id}:${part}-${size}`,part,ap:true,size};}
 return null;
}
function bindingCandidates(row,data,config){const txt=E.normalizeNumbers((row.raw||'')+' '+(row.prep||''));return config.bindings.filter(b=>b.ingredient_ids.includes(row.id)&&b.require_all.every(r=>RX(r,txt))&&!b.exclude_any.some(r=>RX(r,txt))).map(b=>({...b,available_profiles:b.profiles.filter(p=>data.profiles.some(x=>x.id===p))}));}
function directAP(row,identity,dimension){const raw=identity.raw.toLowerCase();
 if(identity.product_id!==row.id)return false; // Freshly squeezed fruit is not bottled juice.
 if(row.id==='ginger'&&identity.spec.form!=='ground')return false;
 if(row.id==='garlic')return false;
 if(/\b(?:homemade|home.made|recipe|see page|see p\.|reserved|rendered|clarified|browned|ghee|whipped)\b/i.test(raw))return false;
 if(/\b(?:salt|sugar|flour)\b/.test(row.id)&&/\b(?:paste|leaves|fresh|chopped)\b/i.test(raw))return false;
 if(row.id==='baking-powder'&&!/\bbaking powder\b/i.test(raw))return false;
 if(row.id==='baking-soda'&&!/\b(?:baking soda|bicarbonate)\b/i.test(raw))return false;
 if(dimension==='mass')return true;
 if(dimension==='volume'&&['salt','kosher-salt','sea-salt'].includes(row.id))return true;
 // Only explicitly named purchased liquid/semiliquid forms have an AP-volume path.
 // Dry solids need a reviewed volume→mass relationship, not a fake zero-loss shortcut.
 return /(?:water|milk|cream|yogurt|oil|vinegar|extract|sauce|sherry|wine|beer|bourbon|brandy|rum|juice|stock|broth|honey|molasses|syrup|mayonnaise|ketchup|mustard|tahini|peanut-butter|tomato-paste)/.test(row.id)&&!/\b(?:dried|powdered|condensed from|reduced|concentrated|evaporated from)\b/i.test(raw);
}
function normalizeOccurrence(recipe,index,data,config,options={}){
 const original=recipe.ingredients[index];if(!original)return gap('MISSING_ROW');
 const occurrence={recipe_id:recipe.id,ingredient_index:index};const identity=sourceIdentity(original);
 const base={occurrence,original,source_identity:identity,source_quantity:null,correction_overlay:null,rule_matches:[],rule_candidates:[],source_inferences:[],price:null,live_price_eligible:false};
 const done=result=>({...base,...result});const hazard=rawHazard(original);if(hazard)return done(gap(hazard));
 if(['to_taste','to-taste'].includes(original.scaling))return done(gap('TO_TASTE'));
 if(/\boptional\b/i.test(identity.raw)&&!options.include_optional)return done(gap('OPTIONAL_INCLUSION_NOT_SELECTED'));
 // A whole egg plus a separated egg part is a typed shared-parent demand, not a complete whole-egg purchase.
 if(['egg','eggs'].includes(original.id)&&/\beggs?\b[\s\S]*\bplus\b[\s\S]*\b(?:egg\s*)?(?:yolks?|whites?)\b/i.test(original.raw||''))return done(gap('SHARED_PARENT_RELATION_REQUIRED',{typed_demand:{whole_egg_qty:original.qty??null,additional_part:/yolk/i.test(original.raw||'')?'yolk':'white'},requires:'Compatible explicit parent/output allocation model.'}));
 const choice=E.selectChoice(original,(options.choices||{})[index]);if(choice.status==='GAP')return done(choice);
 let row=choice.row;if(row.id!==original.id){const override=(options.choice_occurrences||{})[index];if(!override||override.id!==row.id||!override.raw||!override.confirmed_source_choice)return done(gap('ALTERNATIVE_STATE_QUANTITY_REQUIRES_EXPLICIT_SCENARIO',{choices:choice}));row={...row,...override};base.source_inferences.push({type:'explicit_choice_scenario',scenario:choice.scenario});}
 // Text-only "A or B" alternatives not represented upstream still require a choice.
 if(/\bor\b/i.test(row.raw||'')&&!(row.alternatives||[]).length&&!options.explicit_text_choice?.[index]&&!/\bor\b[^,]*(?:more|less|to taste|as needed)/i.test(row.raw||''))return done(gap('TEXT_ALTERNATIVE_REQUIRES_SOURCE_SCENARIO'));
 const iden=sourceIdentity(row);base.source_identity=iden;const cs=countSpec(row,config);
 let parsed;const up=(row.unit_raw||row.unit||'').toLowerCase();
 if(cs&&(['each','other',''].includes(row.unit)||/clove|bunch|head|dozen/.test(up)))parsed=countAmount(row,cs.unit);else parsed=E.rowQuantity(row);
 if(parsed.status==='GAP'||!parsed.quantity)return done(gap(parsed.reason||'QUANTITY_UNRESOLVED',{parsing:parsed}));
 base.correction_overlay=parsed.correction||null;
 let scaled;try{if(row.scaling==='percentage'){const matches=recipe.ingredients.map((r,i)=>({r,i})).filter(x=>x.r.id===row.percentage_of&&(!row.group||x.r.group===row.group));if(matches.length!==1)return done(gap('PERCENTAGE_BASE_UNRESOLVED'));const br=matches[0].r,bp=E.rowQuantity(br);if(!bp.quantity||E.unit(bp.quantity.unit).dimension!=='mass'||E.unit(parsed.quantity.unit).dimension!=='mass')return done(gap('PERCENTAGE_DIMENSION_OR_BASE_UNKNOWN'));const bs=E.scaleQuantity(bp.quantity,options.multiplier||1,br.scaling||'linear'),bc=E.convertExact(bs,bs.unit,parsed.quantity.unit);scaled=E.scaleQuantity({...bc,unit:parsed.quantity.unit},scalar(row.percentage).div(100));base.source_inferences.push({type:'stored_percentage_semantics',percentage:row.percentage,percentage_of:row.percentage_of,base_index:matches[0].i,original_qty:row.qty,computed:scaled,warning:'Stored percentage can be source-rounded; original quantity is preserved, not overwritten.'});}else scaled=E.scaleQuantity(parsed.quantity,options.multiplier||1,row.scaling||'linear');}catch(e){return done(gap(e.code||'SCALING_ERROR'));}
 base.source_quantity=scaled;
 const dim=E.unit(scaled.unit).dimension,raw=E.normalizeNumbers(iden.raw),cands=bindingCandidates(row,data,config);base.rule_candidates=cands.map(b=>({binding_id:b.id,profiles:b.profiles,mode:b.mode,notes:b.notes}));
 const traceDirect=(q,note)=>({status:q.is_range?'COMPUTED_RANGE':'COMPUTED',quantity:q,reason:null,evidence_class:'explicit_source_purchase_form',trace:[{operation:'same_form_AP_requirement',quantity:q,source_recipe_id:recipe.id,source_row:index,raw:row.raw,note}],quantity_complete_for_occurrence:true});
 if(dim==='count'){
  if(cs?.ap){const q=E.quant(scaled,scaled.unit,'AP',iden.product_id,{...iden.spec,size:cs.size,part:cs.part});return done(traceDirect(q,'Whole object/bunch/head count retained as qualified count. No mass, parent-bulb, shell-loss, or cooking-yield inference.'));}
  return done(gap(cs?.part==='clove'?'CLOVE_TO_BULB_SIZE_RELATION_REQUIRED':'SHARED_PARENT_RELATION_REQUIRED',{qualified_demand:scaled,requires:'Explicit compatible source size/output relation or compatible purchase form. Counted cloves are not bulbs; whites and yolks share eggs.'}));
 }
 // Whole bird AP weight is useful independently of future cooked/deboned yield.
 if(dim==='mass'&&/\bwhole\b.*\b(?:chicken|turkey|duck)\b|\b(?:chicken|turkey|duck)\b.*\bwhole\b/i.test(raw)&&!/\b(?:cooked|deboned|boneless)\b/i.test(raw))return done(traceDirect(E.quant(scaled,scaled.unit,'AP',iden.product_id,{...iden.spec,form:'whole-bird'}),'Explicit whole-bird purchase weight; no EP conversion requested.'));
 // S1 narrow change: an explicitly recorded unknown source basis is authoritative and
 // outranks the same-form AP shortcut. Grams or cups are not themselves proof of basis.
 // The known same-form demand is retained so the row stays useful without claiming AP.
 // Inert on the accepted corpus: no runtime ingredient row carries `quantity_basis`.
 if(String(row.quantity_basis||'').toLowerCase()==='unknown')return done(gap('SOURCE_BASIS_UNKNOWN',{qualified_demand:scaled,source_declared_basis:'unknown',requires:'An explicit purchasing basis for this occurrence, or a reviewed relation that accepts an unknown-basis input.'}));
 if(config.ready_form_ids.includes(row.id)&&directAP(row,iden,dim))return done(traceDirect(E.quant(scaled,scaled.unit,'AP',iden.product_id,iden.spec),'Same named purchased form and dimension, not an assumed universal yield=1. Price and package compatibility remain separate.'));
 let allowed=cands.filter(b=>b.mode==='automatic_reference');const policy=options.policies?.[index]||options.ingredient_policies?.[row.id];
 if(policy){
  if(!policy.qualifiers_confirmed||!policy.scenario)return done(gap('REFERENCE_POLICY_REQUIRES_NAMED_QUALIFIER_CONFIRMATION'));
  const chosen=[].concat(policy.profile_ids||[]);const possible=unique(cands.flatMap(b=>b.available_profiles));
  if(!chosen.length||chosen.some(p=>!possible.includes(p)))return done(gap('REFERENCE_POLICY_NOT_APPLICABLE_TO_SOURCE_FORM'));
  if(chosen.includes('QE-FIFTY-1_5-APF-UNSIFTED')&&iden.spec.method==='sifted')return done(gap('MEASURING_METHOD_CONFLICT'));
  allowed=cands.filter(b=>chosen.some(p=>b.available_profiles.includes(p))).map(b=>({...b,available_profiles:b.available_profiles.filter(p=>chosen.includes(p))}));
  base.source_inferences.push({type:'named_reference_policy',scenario:policy.scenario,profile_ids:chosen,qualifiers_confirmed:true,owner_default_changed:false,uncertainty:'Published reference estimate, not measured local density/yield.'});
 }
 if(!allowed.length&&row.id==='lemon-juice'&&iden.spec.form==='freshly-extracted')allowed=[{id:'BIND-FRESH-LEMON-JUICE',available_profiles:['QE-MATH-0284-T1-08'],request_basis:'juice',target_unit:'oz'}];
 if(!allowed.length)return done(gap(cands.some(b=>b.mode==='source_conflict_held')?'SOURCE_RULE_CONFLICT_HELD':cands.length?'REFERENCE_POLICY_OR_MEASURING_METHOD_REQUIRED':'NO_QUALIFIED_RULE_OR_AP_BASIS',{requires:'Explicit purchase/preparation basis and matching reviewed ingredient/form/size/method relationship.'}));
 const results=[];
 for(const b of allowed){const rr=data.rules.filter(r=>b.available_profiles.includes(r.profile_id));const ctx={ingredient_id:row.id,reference_profile_id:b.available_profiles};
  // The qualified basis is selected by the binding, never by the recipe title.
  const q=E.quant(scaled,scaled.unit,b.request_basis,iden.product_id,iden.spec);const res=E.purchaseRequirement(q,{unit:b.target_unit,basis:'AP',product_id:iden.product_id,spec:iden.spec},rr,{context:{...ctx,...iden.spec,form:iden.spec.form}});
  if(res.quantity)results.push({...res,binding_id:b.id});
 }
 base.rule_matches=unique(results.flatMap(x=>x.trace.filter(t=>t.rule_id).map(t=>t.rule_id)));
 if(!results.length)return done(gap('NO_QUALIFIED_PURCHASE_PATH'));
 const vals=unique(results.map(r=>`${r.quantity.min}|${r.quantity.max}|${r.quantity.unit}`));
 if(vals.length>1)return done(gap('REFERENCE_CONFLICT_SELECT_NAMED_POLICY',{alternatives:results}));
 return done({...results[0],reason:null,quantity_complete_for_occurrence:true});
}
function evaluateRecipe(recipe,data,config,options={}){
 const rows=recipe.ingredients.map((_,i)=>normalizeOccurrence(recipe,i,data,config,options));
 return {recipe_id:recipe.id,title:recipe.title,book:recipe.book,page:recipe.page,source_servings:recipe.base_servings,source_yield:recipe.base_yield,multiplier:String(options.multiplier||1),rows,aggregation:E.aggregate(rows),components:(recipe.components||[]).map((c,i)=>({component_index:i,original:c,status:'COMPONENT_SEPARATE',reason:'Use expandComponents with the full runtime; no implicit ingredient double count.'})),coverage:{direct_rows:rows.length,numeric_purchase_rows:rows.filter(r=>r.quantity).length,source_rule_matched_rows:rows.filter(r=>r.rule_matches.length).length,unresolved_rows:rows.filter(r=>!r.quantity).length,live_priced_rows:0},complete_cost:null,price_status:'UNPRICED_PRICE_INTEGRATION_PENDING',warnings:['Ingredient scale is arithmetic, not a promise about cooking time, seasoning, pan capacity or finished batch yield.','Reference estimates are not measured owner yields; no production approval.']};
}
return {stableStringify,sourceIdentity,rawHazard,countSpec,countAmount,bindingCandidates,normalizeOccurrence,evaluateRecipe};
});

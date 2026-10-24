import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { typography } from "../index";
import { useAppearanceTheme } from "./appearance";
import { BthwaniIcon } from "./icons";

type Recipient = Readonly<{role:string;label:string}>;
type Props = Readonly<{
  recipients:ReadonlyArray<Recipient>;
  selected:ReadonlyArray<string>;
  onToggleRecipient:(role:string)=>void;
  onSelectAll:()=>void;
  body:string;
  onChangeText:(text:string)=>void;
  onSend:()=>void;
  onGallery:()=>void;
  onCamera:()=>void;
  onVoice:()=>void;
  onVideo?:()=>void;
  audioControls?:ReactNode;
  disabled?:boolean;
  canSend?:boolean;
}>;
/** Role choices are presentation only. DSH validates actual message recipients. */
export function BthwaniOrderChatComposer({recipients,selected,onToggleRecipient,onSelectAll,body,onChangeText,onSend,onGallery,onCamera,onVoice,onVideo,audioControls,disabled=false,canSend=true}:Props) {
  const theme=useAppearanceTheme();
  const [recipientOpen,setRecipientOpen]=useState(false);
  const [attachmentsOpen,setAttachmentsOpen]=useState(false);
  const chosen=recipients.filter(item=>selected.includes(item.role)).map(item=>item.label);
  const label=chosen.length===1?chosen[0]:chosen.length===recipients.length?"الجميع":chosen.join("، ");
  return <View style={[styles.root,{borderTopColor:theme.borderColor}]}>
    {recipients.length>1?<Pressable accessibilityRole="button" accessibilityLabel={"اختيار المستلمين، "+(label||"لم يتم التحديد")}
      accessibilityState={{expanded:recipientOpen}} style={styles.recipientSummary} onPress={()=>setRecipientOpen(current=>!current)}>
      <Text style={[styles.recipientText,{color:theme.interactiveText}]}>إلى: {label||"اختر المستلم"} ▾</Text>
    </Pressable>:null}
    {recipientOpen?<View style={[styles.options,{backgroundColor:theme.surfaceRaised,borderColor:theme.borderColor}]}>
      {recipients.map(item=><Pressable key={item.role} accessibilityRole="checkbox"
        accessibilityState={{checked:selected.includes(item.role),disabled}}
        disabled={disabled} onPress={()=>onToggleRecipient(item.role)} style={styles.option}>
        <Text style={[styles.optionText,{color:theme.color}]}>{selected.includes(item.role)?"◉":"○"} {item.label}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onSelectAll}><Text style={[styles.optionText,{color:theme.brandAction}]}>الجميع</Text></Pressable>
    </View>:null}
    {attachmentsOpen?<View style={[styles.options,styles.mediaOptions,{backgroundColor:theme.surfaceRaised,borderColor:theme.borderColor}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="التقاط صورة" disabled={disabled} onPress={()=>{setAttachmentsOpen(false);onCamera();}}>
        <Text style={[styles.optionText,{color:theme.color}]}>📷 الكاميرا</Text>
      </Pressable>
      {onVideo?<Pressable accessibilityRole="button" accessibilityLabel="اختيار أو تصوير فيديو" disabled={disabled} onPress={()=>{setAttachmentsOpen(false);onVideo();}}>
        <Text style={[styles.optionText,{color:theme.color}]}>فيديو</Text>
      </Pressable>:null}
      <Pressable accessibilityRole="button" accessibilityLabel="اختيار صورة" disabled={disabled} onPress={()=>{setAttachmentsOpen(false);onGallery();}}>
        <Text style={[styles.optionText,{color:theme.color}]}>▧ المعرض</Text>
      </Pressable>
    </View>:null}
    {audioControls}
    {canSend?<View style={styles.composer}>
      <Pressable accessibilityRole="button" accessibilityLabel="إرفاق صورة" accessibilityState={{expanded:attachmentsOpen}} disabled={disabled}
        style={[styles.round,{backgroundColor:theme.surfaceRaised}]} onPress={()=>setAttachmentsOpen(v=>!v)}>
        <Text style={[styles.plus,{color:theme.color}]}>＋</Text>
      </Pressable>
      <TextInput multiline maxLength={2000} accessibilityLabel="كتابة رسالة" placeholder="اكتب رسالة..."
        placeholderTextColor={theme.colorMuted} editable={!disabled} textAlign="right"
        value={body} onChangeText={onChangeText} style={[styles.input,{color:theme.color,backgroundColor:theme.surface,borderColor:theme.borderColor}]}/>
      <Pressable accessibilityRole="button" accessibilityLabel={body.trim()?"إرسال الرسالة":"تسجيل رسالة صوتية"}
        disabled={disabled||(Boolean(body.trim())&&!selected.length)||(!body.trim()&&!selected.length)}
        style={[styles.round,{backgroundColor:theme.brandAction,opacity:disabled?0.45:1}]}
        onPress={()=>body.trim()?onSend():onVoice()}>
        {body.trim()
          ? <Text style={[styles.action,{color:theme.onAction}]}>➤</Text>
          : <BthwaniIcon name="mic" size={22} color={theme.onAction}/>}
      </Pressable>
    </View>:<Text style={[styles.closed,{color:theme.colorMuted}]}>أُغلقت المحادثة لهذا الطلب.</Text>}
  </View>;
}
const styles=StyleSheet.create({
  root:{gap:7,paddingTop:9,borderTopWidth:1},
  recipientSummary:{alignSelf:"flex-start",paddingHorizontal:8,paddingVertical:5,minHeight:30,justifyContent:"center"},
  recipientText:{...typography.caption,fontWeight:"800"},
  options:{borderWidth:1,borderRadius:12,padding:10,gap:10},
  mediaOptions:{flexDirection:"row",justifyContent:"space-around",alignItems:"center"},
  option:{minHeight:36,justifyContent:"center"},
  optionText:{...typography.bodySm},
  composer:{flexDirection:"row",alignItems:"center",gap:7},
  round:{height:42,width:42,borderRadius:21,alignItems:"center",justifyContent:"center"},
  plus:{fontSize:24},action:{fontSize:19},
  input:{flex:1,minHeight:42,maxHeight:118,borderRadius:19,borderWidth:1,paddingVertical:9,paddingHorizontal:12,...typography.bodySm},
  closed:{...typography.caption,padding:8,textAlign:"center"},
});

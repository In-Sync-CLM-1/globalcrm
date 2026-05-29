/* IEDUP CM YUVA — User Guide (rev.4): English + Hindi, with screenshots & action-based messages */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, VerticalAlign, ImageRun,
} = require("docx");
const fs = require("fs"); const path = require("path");

const PRIMARY="1F4E79", ACCENT="C55A11", HEADFILL="1F4E79", ZEBRA="F2F6FB",
      CALLBLUE="E7F0FA", CALLORANGE="FCE9DA", GREY="595959", GREEN="548235", FONT="Nirmala UI";

const NOBORDER={style:BorderStyle.NONE,size:0,color:"FFFFFF"};
const noBorders={top:NOBORDER,bottom:NOBORDER,left:NOBORDER,right:NOBORDER,insideHorizontal:NOBORDER,insideVertical:NOBORDER};
const thin=(c="BFBFBF")=>({style:BorderStyle.SINGLE,size:4,color:c});
const cellBorders={top:thin(),bottom:thin(),left:thin(),right:thin()};

function run(text,o={}){return new TextRun({text,font:FONT,...o});}
function para(text,o={}){return new Paragraph({children:o.runs||[run(text,o.runOpts||{})],spacing:{after:o.after??120,before:o.before??0,line:276},alignment:o.alignment});}
function bullet(children,o={}){return new Paragraph({children,bullet:{level:o.level??0},spacing:{after:60,line:276}});}
function banner(num,title){return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:noBorders,rows:[new TableRow({children:[new TableCell({
  shading:{type:ShadingType.CLEAR,color:"auto",fill:PRIMARY},margins:{top:80,bottom:80,left:160,right:160},borders:noBorders,
  children:[new Paragraph({spacing:{after:0},children:[run((num?num+".  ":"")+title,{bold:true,color:"FFFFFF",size:26})]})]})]})]});}
function callout(titleText,bodyParas,fill=CALLBLUE,bar=ACCENT){const ch=[];
  if(titleText)ch.push(new Paragraph({spacing:{after:bodyParas&&bodyParas.length?80:0},children:[run(titleText,{bold:true,color:PRIMARY,size:22})]}));
  (bodyParas||[]).forEach(p=>ch.push(p));
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:{...noBorders,left:{style:BorderStyle.SINGLE,size:24,color:bar}},
    rows:[new TableRow({children:[new TableCell({shading:{type:ShadingType.CLEAR,color:"auto",fill},margins:{top:120,bottom:120,left:200,right:200},
    borders:{...noBorders,left:{style:BorderStyle.SINGLE,size:24,color:bar}},children:ch})]})]});}
function spacer(h=120){return new Paragraph({spacing:{after:h},children:[run("")]});}
function pageBreak(){return new Paragraph({children:[new TextRun({text:"",break:1})]});}
function dataTable(headers,rows){
  const hr=new TableRow({tableHeader:true,children:headers.map(h=>new TableCell({width:{size:h.w,type:WidthType.PERCENTAGE},
    shading:{type:ShadingType.CLEAR,color:"auto",fill:HEADFILL},margins:{top:60,bottom:60,left:100,right:100},borders:cellBorders,verticalAlign:VerticalAlign.CENTER,
    children:[new Paragraph({spacing:{after:0},children:[run(h.t,{bold:true,color:"FFFFFF",size:20})]})]}))});
  const br=rows.map((r,ri)=>new TableRow({children:r.map((cell,ci)=>{let paras;
    if(cell&&cell.paras)paras=cell.paras;
    else if(cell&&typeof cell==="object")paras=[new Paragraph({spacing:{after:0},children:[run(cell.text||"",cell.opts||{})]})];
    else paras=[new Paragraph({spacing:{after:0},children:[run(String(cell??""),{size:20})]})];
    return new TableCell({width:{size:headers[ci].w,type:WidthType.PERCENTAGE},shading:ri%2?{type:ShadingType.CLEAR,color:"auto",fill:ZEBRA}:undefined,
      margins:{top:60,bottom:60,left:100,right:100},borders:cellBorders,verticalAlign:VerticalAlign.CENTER,children:paras});})}));
  return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders:{top:thin(),bottom:thin(),left:thin(),right:thin(),insideHorizontal:thin("D9D9D9"),insideVertical:thin("D9D9D9")},rows:[hr,...br]});}
function bilingual(hindi,english){const out=[new Paragraph({spacing:{after:english?40:0},children:[run(hindi,{size:20})]})];
  if(english)out.push(new Paragraph({spacing:{after:0},children:[run(english,{size:18,italics:true,color:GREY})]}));return out;}
function figure(file,w,h,caption){return [
  new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:40,before:40},children:[new ImageRun({type:"png",data:fs.readFileSync(path.join(__dirname,file)),transformation:{width:w,height:h}})]}),
  new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:160},children:[run(caption,{italics:true,size:16,color:GREY})]}),
];}
function compTable(headers,rows){return dataTable(headers,rows.map(r=>[{text:r[0],opts:{bold:true,size:18,color:PRIMARY}},{text:r[1],opts:{size:18}}]));}
function msgCard(actionName,whenLabel,whenText,body,btnLabel,buttons){const b=[];
  b.push(new Paragraph({spacing:{before:170,after:40},children:[run(actionName,{bold:true,color:PRIMARY,size:22})]}));
  b.push(new Paragraph({spacing:{after:80},children:[run(whenLabel+" ",{bold:true,size:18}),run(whenText,{size:18})]}));
  const lines=body.split("\n");
  const bp=lines.map((ln,i)=>new Paragraph({spacing:{after:i===lines.length-1?0:40},children:[run(ln,{size:20})]}));
  if(buttons&&buttons.length)bp.push(new Paragraph({spacing:{before:80,after:0},children:[run(btnLabel+"  ",{bold:true,size:18,color:PRIMARY}),
    ...buttons.flatMap((x,i)=>[run("[ "+x+" ]",{size:18,bold:true,color:PRIMARY}),run(i<buttons.length-1?"   ":"  ",{size:18})])]}));
  b.push(callout(null,bp,CALLBLUE,PRIMARY));
  return b;}

// shared Hindi message bodies
const BODY_HELPDESK="नमस्कार [नाम], सीएम युवा योजना के अंतर्गत आपके ऋण की स्वीकृति पर हार्दिक बधाई। ऋण वितरण से पूर्व पाँच दिवसीय उद्यमिता विकास (EDP) प्रशिक्षण पूर्ण करना अनिवार्य है। कृपया नीचे दिए गए बटन पर क्लिक कर पंजीकरण करके प्रशिक्षण पूर्ण करें।\n\nHelp desk: 9369124402\nधन्यवाद,\nउद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ";
const BODY_REG="प्रिय प्रतिभागी,\n\nसीएम युवा योजना के अंतर्गत आपके पाँच दिवसीय (कुल 30 घंटे) अनिवार्य प्रशिक्षण हेतु पंजीकरण के लिए कृपया निम्नलिखित चरण पूर्ण करें:\n\n1. नीचे दिए गए ‘लॉगिन करें’ बटन पर क्लिक करें। लॉगिन हेतु अपना आधार नंबर एवं पंजीकृत मोबाइल नंबर उपयोग करें।\n2. लॉगिन के उपरांत फोटो कैप्चर (Photo Capture) की प्रक्रिया पूर्ण करें।\n3. प्रशिक्षण 5 दिन (कुल 30 घंटे) का है; आपको प्रतिदिन नए लेक्चर वीडियो उपलब्ध कराए जाएंगे।\n4. अगले दिन के वीडियो तभी उपलब्ध होंगे जब आप पिछले दिन के सभी वीडियो पूर्ण रूप से देख लेंगे।\n5. सभी लेक्चर वीडियो पूरी तरह देखना अनिवार्य है; किसी वीडियो को अधूरा छोड़ने पर उपस्थिति दर्ज नहीं की जाएगी।\n\nधन्यवाद,\nउद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ (IEDUP)";
const BODY_PAY="प्रिय प्रतिभागी,\n\nसीएम युवा योजना के अंतर्गत आपके प्रशिक्षण पंजीकरण हेतु किया गया भुगतान सफल नहीं हो सका।\n\nकृपया नीचे दिए गए ‘लॉगिन करें’ बटन पर क्लिक करके पुनः भुगतान प्रक्रिया पूर्ण करें, ताकि आपका पंजीकरण सुनिश्चित हो सके।\n\nकिसी भी सहायता हेतु — Help desk: 9369124402\n\nधन्यवाद,\nउद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ";
const BODY_PHOTO="प्रिय प्रतिभागी,\nआपके पोर्टल पर अपलोड की गई फोटो प्रमाण पत्र हेतु उपयुक्त नहीं है। कृपया प्रमाण पत्र के लिए अपनी एक साफ़ एवं proper dressed फोटो अपने नाम और मोबाइल नंबर के साथ शेयर करें।\n\nधन्यवाद,\nउद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ";
const BODY_CERT="प्रिय प्रतिभागियों,\n\nजिन प्रतिभागियों के प्रशिक्षण के सभी मानक पूर्ण हो गए हैं, उनका प्रमाण पत्र उनकी लॉगिन आईडी पर उपलब्ध हो गया है।\n\nकृपया नीचे दिए गए ‘लॉगिन करें’ बटन पर क्लिक करके लॉगिन कीजिए और अपना प्रमाण पत्र डाउनलोड कीजिए।\n\nआपको सफलतापूर्वक मुख्यमंत्री युवा उद्यमी प्रशिक्षण पूर्ण करने की हार्दिक शुभकामनाएं। आपका व्यवसाय और आपका भविष्य उज्जवल हो।\n\nधन्यवाद, टीम — उद्यमिता विकास संस्थान, उत्तर प्रदेश सरकार, लखनऊ";

const A_HELP="Send WhatsApp - Add help desk number";
const A_REG="Send WhatsApp - After registration & payment verification";
const A_PAY="Send WhatsApp - Payment failed";
const A_PHOTO="Send WhatsApp - Photo rejected";
const A_CERT="Send WhatsApp - After certificate";
const PIPE_W=648, PIPE_H=309, DASH_W=648, DASH_H=302;

const kids=[];

/* ===================== ENGLISH ===================== */
kids.push(new Paragraph({spacing:{before:600,after:0},alignment:AlignmentType.CENTER,children:[run("IEDUP · CM YUVA YOJANA",{bold:true,color:ACCENT,size:24})]}));
kids.push(new Paragraph({spacing:{before:120,after:0},alignment:AlignmentType.CENTER,children:[run("Automated Call & WhatsApp",{bold:true,color:PRIMARY,size:52})]}));
kids.push(new Paragraph({spacing:{before:0,after:200},alignment:AlignmentType.CENTER,children:[run("Notification System — User Guide",{bold:true,color:PRIMARY,size:52})]}));
kids.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},children:[run("मुख्यमंत्री युवा उद्यमी योजना",{size:26,color:GREY})]}));
kids.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:120},children:[run("Udyamita Vikas Sansthan · Department of MSME & Export Promotion · Government of Uttar Pradesh, Lucknow",{size:20,italics:true,color:GREY})]}));
kids.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:200},children:[run("English version below · हिंदी संस्करण आगे दिया गया है",{size:18,bold:true,color:ACCENT})]}));
kids.push(callout(null,[new Paragraph({spacing:{after:0},children:[run("What this is:  ",{bold:true,size:22,color:PRIMARY}),
  run("A plain-language guide to the system that calls CM YUVA loan-approved beneficiaries and messages them on WhatsApp — the screens you use, the call script, the questions the AI answers, and every WhatsApp message it sends.",{size:22})]})],CALLORANGE,ACCENT));
kids.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:300,after:0},children:[run("Prepared by In-Sync  ·  Updated 27 May 2026  ·  Live system snapshot",{size:18,color:GREY,italics:true})]}));
kids.push(pageBreak());

kids.push(banner(1,"What the System Does"));kids.push(spacer(120));
kids.push(para("The system automatically reaches every CM YUVA beneficiary whose loan has been approved. It places an AI voice call in Hindi telling them that a 5-day Entrepreneurship Development Programme (EDP) training is mandatory before their loan is disbursed — and immediately follows up on WhatsApp with the right link or instructions.",{after:120}));
kids.push(callout("This is a notification system — not a sales call.",[para("Each beneficiary gets one clear, calm message. The AI never pressures or sells; it informs and points them to the registration link.",{after:0,runOpts:{size:20}})],CALLBLUE,PRIMARY));
kids.push(spacer(120));
kids.push(new Paragraph({spacing:{after:100},children:[run("How it works — 4 steps",{bold:true,color:PRIMARY,size:24})]}));
kids.push(dataTable([{t:"Step",w:8},{t:"What happens",w:32},{t:"Detail",w:60}],[
  [{text:"1",opts:{bold:true,color:ACCENT,size:24}},{text:"You upload beneficiaries",opts:{bold:true,size:20}},{text:"Each beneficiary is uploaded with an Action that tells the system what to do — make a Call, or send a specific WhatsApp message.",opts:{size:20}}],
  [{text:"2",opts:{bold:true,color:ACCENT,size:24}},{text:"The system acts on its own",opts:{bold:true,size:20}},{text:"Every 5 minutes, during the allowed hours, it picks up new beneficiaries and processes them automatically.",opts:{size:20}}],
  [{text:"3",opts:{bold:true,color:ACCENT,size:24}},{text:"Call and / or WhatsApp goes out",opts:{bold:true,size:20}},{text:"The AI agent “Anjali” calls in Hindi, or the chosen WhatsApp message is sent from +91 8808359820.",opts:{size:20}}],
  [{text:"4",opts:{bold:true,color:ACCENT,size:24}},{text:"Status updates by itself",opts:{bold:true,size:20}},{text:"Each beneficiary is marked Call made / Message Sent / Delivered / Opened — no manual tracking needed.",opts:{size:20}}],
]));
kids.push(pageBreak());

kids.push(banner(2,"The Pipeline Screen"));kids.push(spacer(120));
kids.push(para("This is your main working screen. From here you upload beneficiaries, set the calling / messaging hours, and watch each beneficiary move along.",{after:60}));
figure("shot_pipeline.png",PIPE_W,PIPE_H,"The Pipeline screen — upload, set hours, and track every beneficiary.").forEach(p=>kids.push(p));
kids.push(compTable([{t:"Component",w:30},{t:"What it does",w:70}],[
  ["Add beneficiary","Add a single beneficiary manually."],
  ["Upload CSV","Upload a batch of beneficiaries from a spreadsheet."],
  ["CSV template","Download the spreadsheet format to fill in — it includes the Action column."],
  ["Start","Begins processing the queue (calls and messages) within the active hours."],
  ["Calling windows (IST)","The hours when calls and messages go out — shown here as 10:00–13:30 and 15:00–18:00. Use ‘Add window’ to add another slot, or ✕ to remove one."],
  ["Beneficiaries · total","The full uploaded list with a live count (505 here)."],
  ["Uploaded from / to","Filter the list to a date range of uploads."],
  ["Hide ineligible","Hides beneficiaries already connected, or beyond the daily cap."],
  ["Name (EN) / Name (HI)","The beneficiary's name in English and Hindi — the Hindi spelling is used for correct pronunciation on the call."],
  ["Number","The beneficiary's phone number."],
  ["Action","What the system will do for this beneficiary — a Call, or a specific ‘Send WhatsApp – …’ message. This is the trigger you set."],
  ["Uploaded","The date the beneficiary was added."],
  ["Status","‘Pending’ until the action has been carried out."],
  ["Disposition","The latest outcome — e.g. Message Delivered, Message Opened, Call made."],
  ["Last call","When the last call was placed (— if none yet)."],
  ["Actions","Per-row controls: the phone icon places a call now; the bin icon removes the beneficiary."],
]));
kids.push(spacer(120));
kids.push(callout(null,[para("Note: the left-hand menu also has other areas; this guide covers the Pipeline and Dashboard screens only.",{after:0,runOpts:{size:18,italics:true}})],CALLBLUE,PRIMARY));
kids.push(pageBreak());

kids.push(banner(3,"The Dashboard Screen"));kids.push(spacer(120));
kids.push(para("A read-only overview of how the outreach is performing. Nothing here changes settings — it is purely for monitoring.",{after:60}));
figure("shot_dashboard.png",DASH_W,DASH_H,"The IEDUP Dashboard — outreach performance at a glance.").forEach(p=>kids.push(p));
kids.push(compTable([{t:"Component",w:32},{t:"What it shows",w:68}],[
  ["Date range (e.g. ‘This Month’)","Sets the period that every number and chart below covers."],
  ["Dialing indicator","Shows whether automated calling is currently ON or OFF."],
  ["Beneficiaries","Total people in the system for the period."],
  ["Pending","How many have not been acted on yet."],
  ["Messages sent","Total WhatsApp messages sent."],
  ["Delivery rate","Share of sent messages that reached phones."],
  ["Open rate","Share of delivered messages that were read."],
  ["Calls placed","Number of AI calls made."],
  ["WhatsApp outreach over time","Daily trend of Sent → Delivered → Opened."],
  ["Delivery funnel","How many messages moved from Sent, to Delivered, to Opened."],
  ["Calls over time","Calls Placed vs Connected, by day."],
  ["By message type","Sent vs Opened broken down per message type (Help desk, registration steps, Payment failed, Certificate ready, Photo re-upload, Training link)."],
]));
kids.push(pageBreak());

kids.push(banner(4,"Operating Limits & Capacity"));kids.push(spacer(120));
kids.push(para("These settings control when the system runs and how fast it works.",{after:140}));
kids.push(dataTable([{t:"Setting",w:30},{t:"Current value",w:28},{t:"What it means for you",w:42}],[
  [{text:"Active hours (calls & WhatsApp)",opts:{bold:true,size:20}},{text:"10:00 AM – 1:30 PM and 3:00 PM – 6:00 PM IST",opts:{size:20}},"Outside these hours nothing is sent — beneficiaries wait in the queue until the next active window. (Set on the Pipeline screen.)"],
  [{text:"Act on today's uploads only",opts:{bold:true,size:20}},{text:"ON",opts:{bold:true,color:GREEN,size:20}},"The system only acts on beneficiaries uploaded the SAME day. Old lists are never re-contacted."],
  [{text:"Auto safety stop",opts:{bold:true,size:20}},{text:"ON",opts:{bold:true,color:GREEN,size:20}},"If the account balance runs out, all calls and messages pause automatically — a built-in safety net."],
  [{text:"WhatsApp per cycle",opts:{bold:true,size:20}},{text:"Up to 25 messages",opts:{size:20}},"Sent in batches every 5 minutes — keeps volume steady and within WhatsApp limits."],
  [{text:"Calls at a time",opts:{bold:true,size:20}},{text:"Up to 3 simultaneously",opts:{size:20}},"Prevents overloading the calling line."],
  [{text:"Processing frequency",opts:{bold:true,size:20}},{text:"Every 5 minutes",opts:{size:20}},"How often the system wakes up to act on the queue."],
  [{text:"WhatsApp sender number",opts:{bold:true,size:20}},{text:"+91 8808359820",opts:{size:20}},"All IEDUP WhatsApp messages come from this number."],
]));
kids.push(pageBreak());

kids.push(banner(5,"The Phone Call — Script"));kids.push(spacer(120));
kids.push(para("",{after:140,runs:[run("Agent: ",{bold:true,size:22}),run("“Anjali” — a soothing Hindi voice.  ",{size:22}),run("Language: ",{bold:true,size:22}),run("Hindi (with common English words).  ",{size:22}),run("If asked, she discloses she is an AI.",{size:22})]}));
kids.push(callout("How the call is structured",[
  bullet([run("The AI delivers the full message in ONE calm turn — it does not interrupt with questions.",{size:20})]),
  bullet([run("It asks only two questions: at the start (“Am I speaking with …?”) and at the end (“और कुछ?” — anything else?).",{size:20})]),
  bullet([run("Any question from the beneficiary is answered in 1–2 sentences, then it continues.",{size:20})]),
  bullet([run("If the person says thanks / OK / nothing else, it says goodbye. It also hangs up politely after 8 seconds of silence.",{size:20})]),
],CALLBLUE,PRIMARY));
kids.push(spacer(140));
kids.push(dataTable([{t:"Stage",w:24},{t:"What the AI says (Hindi) + meaning (English)",w:76}],[
  [{text:"Opening (identity check)",opts:{bold:true,size:20,color:PRIMARY}},{paras:bilingual("नमस्ते, मैं IEDUP — उद्यमिता विकास संस्थान, लखनऊ से बात कर रही हूँ। क्या मैं [नाम] जी से बात कर रही हूँ?","“Hello, I'm calling from IEDUP — Udyamita Vikas Sansthan, Lucknow. Am I speaking with [name] ji?”")}],
  [{text:"Main message (full notification, one turn)",opts:{bold:true,size:20,color:PRIMARY}},{paras:bilingual("बहुत अच्छा। सबसे पहले, CM युवा योजना के तहत आपके loan की स्वीकृति पर हार्दिक बधाई। आपको सूचित करना है कि loan vitran से पहले 5 दिन का EDP प्रशिक्षण पूरा करना अनिवार्य है। यह प्रशिक्षण पूरी तरह online है, आप mobile, laptop, या computer से कर सकते हैं। मैं अभी आपको WhatsApp पर registration link भेज रही हूँ, कृपया आज ही register कर लीजिए। एक ज़रूरी बात — रजिस्ट्रेशन form में Applicant Code field में अपना CM युवा Application Number ज़रूर डालें।","“Congratulations on your CM YUVA loan approval. Before disbursal, completing the 5-day EDP training is mandatory. It is fully online — mobile, laptop or computer. I'm sending the registration link on WhatsApp now; please register today. Important: in the form's Applicant Code field, enter your CM YUVA Application Number.”")}],
  [{text:"Closing",opts:{bold:true,size:20,color:PRIMARY}},{paras:bilingual("और कुछ?  →  धन्यवाद, आपका दिन शुभ हो।","“Anything else?”  →  “Thank you, have a good day.”")}],
]));
kids.push(pageBreak());

kids.push(banner(6,"Call Q&A — What the AI Answers"));kids.push(spacer(120));
kids.push(para("If a beneficiary asks any of these, the AI replies briefly (in Hindi) and then continues. English meaning shown in grey.",{after:140}));
const qaEN=[
  ["Who are you?","आप कौन हैं","मैं IEDUP, Government of Uttar Pradesh की तरफ़ से बात कर रही हूँ — यह CM युवा loan benefit के बारे में सूचना है।","I'm calling on behalf of IEDUP, Govt. of UP — about your CM YUVA loan benefit."],
  ["Are you an AI?","क्या आप AI हैं","जी हाँ, मैं एक AI agent हूँ।","Yes, I am an AI agent."],
  ["Which link?","कौन सा link","call के तुरंत बाद आपके WhatsApp पर link आ जाएगा।","The link arrives on your WhatsApp right after this call."],
  ["I'm busy right now","मैं अभी busy हूँ","कोई बात नहीं। मैं link WhatsApp पर भेज रही हूँ, time मिलते ही complete कर लीजिए।","No problem — I'm sending the link on WhatsApp; complete it when free."],
  ["What does training cost?","कितने की है / fees","training की fee 1180 रुपये है, GST सहित।","The training fee is ₹1,180, including GST."],
  ["How is training done?","प्रशिक्षण कैसे होगा","पूरी तरह online है, आप mobile, laptop, या computer से कर सकते हैं।","Fully online — mobile, laptop or computer."],
  ["What is taught?","क्या सिखाया जाएगा","Business Management, Marketing, Finance, Government Schemes, और Entrepreneurship से जुड़े topics।","Business Management, Marketing, Finance, Government Schemes and Entrepreneurship."],
  ["How many days?","कितने दिन","5 दिन का प्रशिक्षण है, total 30 घंटे, daily maximum 6 घंटे।","5 days, 30 hours total, max 6 hours per day."],
  ["Is there a test?","Test भी होगा","जी हाँ, 5 दिन की training के बाद online assessment है।","Yes — an online assessment after the 5 days."],
  ["When is the certificate?","Certificate कब","assessment पूरा होने के बाद उसी portal पर मिल जाएगा।","On the same portal, after the assessment."],
  ["Can I do it on mobile?","Mobile से कर सकते हैं","जी हाँ, किसी भी device से कर सकते हैं।","Yes — any device works."],
  ["Internet drops?","Internet problem हो जाए","दोबारा login करके training जारी रख सकते हैं।","Just log in again and continue."],
  ["If I don't complete it?","पूरी नहीं की तो","यह अनिवार्य है, पूरी न करने पर loan process प्रभावित हो सकती है।","It's mandatory — not completing can affect your loan."],
  ["I already did it","पहले से कर लिया","बहुत अच्छा, धन्यवाद।","Great, thank you."],
  ["Wrong person","मैं वो व्यक्ति नहीं हूँ","माफ़ कीजिए, यह number [नाम] जी का है क्या?","Apologies — is this number [name] ji's?"],
  ["Login trouble","Login में problem","IEDUP helpdesk पर contact करें — 9369124402।","Contact the IEDUP helpdesk — 9369124402."],
  ["Don't call me","call मत करो","बिल्कुल, माफ़ कीजिए। आपका नाम Do-Not-Call list में डाल दूंगी।","Of course, sorry — I'll add you to the Do-Not-Call list."],
];
kids.push(dataTable([{t:"Beneficiary asks",w:24},{t:"In Hindi",w:20},{t:"AI's answer (Hindi) + meaning",w:56}],
  qaEN.map(q=>[{text:q[0],opts:{bold:true,size:18,color:PRIMARY}},{text:q[1],opts:{size:18}},{paras:bilingual(q[2],q[3])}])));
kids.push(pageBreak());

kids.push(banner(7,"WhatsApp Messages"));kids.push(spacer(120));
kids.push(para("The Action you set on a beneficiary decides which message is sent. Here is the full mapping, then each message in detail.",{after:140}));
kids.push(dataTable([{t:"Action you set",w:52},{t:"What the beneficiary receives",w:48}],[
  [{text:"Call",opts:{bold:true,size:19}},{text:"AI voice call (Anjali) about the mandatory training",opts:{size:19}}],
  [{text:A_HELP,opts:{bold:true,size:19}},{text:"Welcome + registration link + helpdesk number",opts:{size:19}}],
  [{text:A_REG,opts:{bold:true,size:19}},{text:"Step-by-step training instructions",opts:{size:19}}],
  [{text:A_PAY,opts:{bold:true,size:19}},{text:"Request to retry the payment",opts:{size:19}}],
  [{text:A_PHOTO,opts:{bold:true,size:19}},{text:"Request to re-share a clear photo",opts:{size:19}}],
  [{text:A_CERT,opts:{bold:true,size:19}},{text:"Certificate-ready download notice",opts:{size:19}}],
]));
kids.push(spacer(160));
kids.push(new Paragraph({spacing:{after:60},children:[run("Each message in full",{bold:true,color:PRIMARY,size:24})]}));
msgCard(A_HELP,"When to use it:","To welcome a loan-approved beneficiary and send the registration link (includes the helpdesk number).",BODY_HELPDESK,"Buttons:",["पंजीकरण करें  (Register)"]).forEach(b=>kids.push(b));
msgCard(A_REG,"When to use it:","After the beneficiary has registered and paid — explains how the training works.",BODY_REG,"Buttons:",["लॉगिन करें (Login)"]).forEach(b=>kids.push(b));
msgCard(A_PAY,"When to use it:","When a beneficiary's registration payment did not go through — asks them to retry.",BODY_PAY,"Buttons:",["लॉगिन करें (Login)"]).forEach(b=>kids.push(b));
msgCard(A_PHOTO,"When to use it:","When the uploaded certificate photo is not acceptable — asks for a clear new one.",BODY_PHOTO,"Buttons:",[]).forEach(b=>kids.push(b));
msgCard(A_CERT,"When to use it:","When the beneficiary's certificate is ready — tells them they can download it.",BODY_CERT,"Buttons:",["लॉगिन करें (Login)"]).forEach(b=>kids.push(b));
kids.push(pageBreak());

kids.push(banner(8,"Statuses You'll See"));kids.push(spacer(120));
kids.push(para("Every beneficiary's status updates automatically — you never set these by hand.",{after:140}));
kids.push(dataTable([{t:"Status",w:28},{t:"Meaning",w:72}],[
  [{text:"Call made",opts:{bold:true,size:20,color:PRIMARY}},"The AI voice call was placed to this beneficiary."],
  [{text:"Message Sent",opts:{bold:true,size:20,color:PRIMARY}},"The WhatsApp message left our system towards the beneficiary."],
  [{text:"Message Delivered",opts:{bold:true,size:20,color:PRIMARY}},"The message reached the beneficiary's phone."],
  [{text:"Message Opened",opts:{bold:true,size:20,color:PRIMARY}},"The beneficiary opened and read the message."],
]));
kids.push(pageBreak());

kids.push(banner(9,"Quick Reference"));kids.push(spacer(120));
kids.push(dataTable([{t:"Item",w:34},{t:"Detail",w:66}],[
  [{text:"Helpdesk phone",opts:{bold:true,size:20}},{text:"9369124402",opts:{size:20}}],
  [{text:"Helpdesk email",opts:{bold:true,size:20}},{text:"cmyuvaiedup@gmail.com",opts:{size:20}}],
  [{text:"Beneficiary portal",opts:{bold:true,size:20}},{text:"cmyuva.iedup.co.in  (login.php / registration_form.php)",opts:{size:20}}],
  [{text:"WhatsApp sender number",opts:{bold:true,size:20}},{text:"+91 8808359820",opts:{size:20}}],
  [{text:"Training format",opts:{bold:true,size:20}},{text:"5 days · 30 hours total · fully online · any device",opts:{size:20}}],
  [{text:"Registration tip",opts:{bold:true,size:20}},{text:"In the form's Applicant Code field, enter the CM YUVA Application Number.",opts:{size:20}}],
]));
kids.push(spacer(160));
kids.push(callout("Important — avoid duplicate calls / messages",[para("Do not re-upload the same beneficiaries to re-trigger their Action — the system does not de-duplicate by phone number, so re-uploading creates duplicate records that can be contacted again. Always upload fresh batches only.",{after:0,runOpts:{size:20}})],CALLORANGE,ACCENT));
kids.push(pageBreak());

/* ===================== हिंदी ===================== */
kids.push(new Paragraph({spacing:{before:1400,after:80},alignment:AlignmentType.CENTER,children:[run("———  हिंदी संस्करण  ———",{bold:true,color:ACCENT,size:28})]}));
kids.push(new Paragraph({spacing:{after:0},alignment:AlignmentType.CENTER,children:[run("स्वचालित कॉल एवं व्हाट्सएप",{bold:true,color:PRIMARY,size:48})]}));
kids.push(new Paragraph({spacing:{after:200},alignment:AlignmentType.CENTER,children:[run("सूचना प्रणाली — उपयोगकर्ता मार्गदर्शिका",{bold:true,color:PRIMARY,size:48})]}));
kids.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:60},children:[run("मुख्यमंत्री युवा उद्यमी योजना",{size:26,color:GREY})]}));
kids.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:240},children:[run("उद्यमिता विकास संस्थान · सूक्ष्म, लघु एवं मध्यम उद्यम विभाग · उत्तर प्रदेश सरकार, लखनऊ",{size:20,italics:true,color:GREY})]}));
kids.push(callout(null,[new Paragraph({spacing:{after:0},children:[run("यह क्या है:  ",{bold:true,size:22,color:PRIMARY}),
  run("यह सरल भाषा में उस प्रणाली की मार्गदर्शिका है जो सीएम युवा (ऋण-स्वीकृत) लाभार्थियों को कॉल करती है और व्हाट्सएप पर संदेश भेजती है — आपके द्वारा उपयोग की जाने वाली स्क्रीन, कॉल स्क्रिप्ट, AI द्वारा दिए जाने वाले उत्तर, तथा भेजे जाने वाले प्रत्येक व्हाट्सएप संदेश सहित।",{size:22})]})],CALLORANGE,ACCENT));
kids.push(pageBreak());

kids.push(banner(1,"प्रणाली क्या करती है"));kids.push(spacer(120));
kids.push(para("यह प्रणाली प्रत्येक सीएम युवा लाभार्थी से स्वतः संपर्क करती है जिनका ऋण स्वीकृत हो चुका है। यह हिंदी में एक AI वॉइस कॉल करती है जिसमें बताया जाता है कि ऋण वितरण से पूर्व 5 दिवसीय उद्यमिता विकास (EDP) प्रशिक्षण पूर्ण करना अनिवार्य है — और तुरंत बाद व्हाट्सएप पर उपयुक्त लिंक अथवा निर्देश भेजती है।",{after:120}));
kids.push(callout("यह एक सूचना प्रणाली है — बिक्री कॉल नहीं।",[para("प्रत्येक लाभार्थी को एक स्पष्ट एवं शांत संदेश मिलता है। AI कभी दबाव या बिक्री नहीं करती; यह केवल सूचित करती है और पंजीकरण लिंक की ओर मार्गदर्शन करती है।",{after:0,runOpts:{size:20}})],CALLBLUE,PRIMARY));
kids.push(spacer(120));
kids.push(new Paragraph({spacing:{after:100},children:[run("यह कैसे काम करती है — 4 चरण",{bold:true,color:PRIMARY,size:24})]}));
kids.push(dataTable([{t:"चरण",w:8},{t:"क्या होता है",w:32},{t:"विवरण",w:60}],[
  [{text:"1",opts:{bold:true,color:ACCENT,size:24}},{text:"आप लाभार्थी अपलोड करते हैं",opts:{bold:true,size:20}},{text:"प्रत्येक लाभार्थी को एक ‘एक्शन’ (Action) के साथ अपलोड किया जाता है जो प्रणाली को बताता है कि क्या करना है — कॉल करें, या कोई विशिष्ट व्हाट्सएप संदेश भेजें।",opts:{size:20}}],
  [{text:"2",opts:{bold:true,color:ACCENT,size:24}},{text:"प्रणाली स्वयं कार्य करती है",opts:{bold:true,size:20}},{text:"हर 5 मिनट में, अनुमत घंटों के दौरान, यह नए लाभार्थियों को उठाती है और स्वतः प्रसंस्करण करती है।",opts:{size:20}}],
  [{text:"3",opts:{bold:true,color:ACCENT,size:24}},{text:"कॉल और/या व्हाट्सएप भेजा जाता है",opts:{bold:true,size:20}},{text:"AI एजेंट ‘अंजली’ हिंदी में कॉल करती है, या चुना गया व्हाट्सएप संदेश +91 8808359820 से भेजा जाता है।",opts:{size:20}}],
  [{text:"4",opts:{bold:true,color:ACCENT,size:24}},{text:"स्थिति स्वतः अपडेट होती है",opts:{bold:true,size:20}},{text:"प्रत्येक लाभार्थी को कॉल किया गया / संदेश भेजा गया / डिलीवर हुआ / खोला गया के रूप में चिह्नित किया जाता है।",opts:{size:20}}],
]));
kids.push(pageBreak());

kids.push(banner(2,"पाइपलाइन (Pipeline) स्क्रीन"));kids.push(spacer(120));
kids.push(para("यह आपकी मुख्य कार्य-स्क्रीन है। यहाँ से आप लाभार्थी अपलोड करते हैं, कॉल/संदेश के घंटे तय करते हैं, और प्रत्येक लाभार्थी की प्रगति देखते हैं।",{after:60}));
figure("shot_pipeline.png",PIPE_W,PIPE_H,"पाइपलाइन स्क्रीन — अपलोड करें, घंटे तय करें, और हर लाभार्थी को ट्रैक करें।").forEach(p=>kids.push(p));
kids.push(compTable([{t:"घटक (Component)",w:30},{t:"यह क्या करता है",w:70}],[
  ["Add beneficiary","एक लाभार्थी को मैन्युअल रूप से जोड़ें।"],
  ["Upload CSV","स्प्रेडशीट से लाभार्थियों का बैच अपलोड करें।"],
  ["CSV template","भरने हेतु स्प्रेडशीट प्रारूप डाउनलोड करें — इसमें Action कॉलम शामिल है।"],
  ["Start","सक्रिय घंटों के भीतर कतार (कॉल एवं संदेश) का प्रसंस्करण आरंभ करता है।"],
  ["Calling windows (IST)","वे घंटे जब कॉल एवं संदेश भेजे जाते हैं — यहाँ 10:00–13:30 तथा 15:00–18:00। नया स्लॉट जोड़ने हेतु ‘Add window’, हटाने हेतु ✕।"],
  ["Beneficiaries · total","पूरी अपलोड सूची एवं लाइव गिनती (यहाँ 505)।"],
  ["Uploaded from / to","सूची को अपलोड की तिथि-सीमा अनुसार छाँटें।"],
  ["Hide ineligible","पहले से कनेक्ट हो चुके या दैनिक सीमा पार कर चुके लाभार्थियों को छिपाता है।"],
  ["Name (EN) / Name (HI)","लाभार्थी का नाम अंग्रेज़ी एवं हिंदी में — कॉल पर सही उच्चारण हेतु हिंदी वर्तनी का उपयोग होता है।"],
  ["Number","लाभार्थी का फोन नंबर।"],
  ["Action","प्रणाली इस लाभार्थी के लिए क्या करेगी — कॉल, या कोई विशिष्ट ‘Send WhatsApp – …’ संदेश। यही वह ट्रिगर है जो आप सेट करते हैं।"],
  ["Uploaded","लाभार्थी को जोड़ने की तिथि।"],
  ["Status","कार्य पूर्ण होने तक ‘Pending’।"],
  ["Disposition","नवीनतम परिणाम — जैसे Message Delivered, Message Opened, Call made।"],
  ["Last call","अंतिम कॉल कब की गई (अभी तक नहीं तो —)।"],
  ["Actions","प्रति-पंक्ति नियंत्रण: फोन आइकन अभी कॉल करता है; बिन आइकन लाभार्थी को हटाता है।"],
]));
kids.push(spacer(120));
kids.push(callout(null,[para("नोट: बाएँ मेनू में अन्य अनुभाग भी हैं; यह मार्गदर्शिका केवल पाइपलाइन एवं डैशबोर्ड स्क्रीन को कवर करती है।",{after:0,runOpts:{size:18,italics:true}})],CALLBLUE,PRIMARY));
kids.push(pageBreak());

kids.push(banner(3,"डैशबोर्ड (Dashboard) स्क्रीन"));kids.push(spacer(120));
kids.push(para("यह आउटरीच के प्रदर्शन का केवल-पठन (read-only) सारांश है। यहाँ कोई सेटिंग नहीं बदलती — यह केवल निगरानी हेतु है।",{after:60}));
figure("shot_dashboard.png",DASH_W,DASH_H,"IEDUP डैशबोर्ड — एक नज़र में आउटरीच प्रदर्शन।").forEach(p=>kids.push(p));
kids.push(compTable([{t:"घटक (Component)",w:32},{t:"यह क्या दर्शाता है",w:68}],[
  ["Date range (‘This Month’)","नीचे की सभी संख्याएँ एवं चार्ट जिस अवधि को दर्शाते हैं, वह तय करता है।"],
  ["Dialing indicator","दर्शाता है कि स्वचालित कॉलिंग अभी चालू (ON) है या बंद (OFF)।"],
  ["Beneficiaries","अवधि में कुल लाभार्थी।"],
  ["Pending","कितनों पर अभी कार्य नहीं हुआ।"],
  ["Messages sent","भेजे गए कुल व्हाट्सएप संदेश।"],
  ["Delivery rate","भेजे गए संदेशों में से कितने फोन तक पहुँचे।"],
  ["Open rate","डिलीवर हुए संदेशों में से कितने पढ़े गए।"],
  ["Calls placed","की गई AI कॉल की संख्या।"],
  ["WhatsApp outreach over time","Sent → Delivered → Opened का दैनिक रुझान।"],
  ["Delivery funnel","कितने संदेश Sent से Delivered और फिर Opened तक पहुँचे।"],
  ["Calls over time","प्रतिदिन Placed बनाम Connected कॉल।"],
  ["By message type","प्रत्येक संदेश प्रकार के अनुसार Sent बनाम Opened (Help desk, registration steps, Payment failed, Certificate ready, Photo re-upload, Training link)।"],
]));
kids.push(pageBreak());

kids.push(banner(4,"संचालन सीमाएँ एवं क्षमता"));kids.push(spacer(120));
kids.push(para("ये सेटिंग्स नियंत्रित करती हैं कि प्रणाली कब और कितनी तेज़ी से चलती है।",{after:140}));
kids.push(dataTable([{t:"सेटिंग",w:30},{t:"वर्तमान मान",w:28},{t:"आपके लिए इसका अर्थ",w:42}],[
  [{text:"सक्रिय घंटे (कॉल एवं व्हाट्सएप)",opts:{bold:true,size:20}},{text:"प्रातः 10:00 – दोपहर 1:30 तथा अपराह्न 3:00 – सायं 6:00 (IST)",opts:{size:20}},"इन घंटों के बाहर कुछ नहीं भेजा जाता — लाभार्थी अगली सक्रिय अवधि तक कतार में प्रतीक्षा करते हैं। (पाइपलाइन स्क्रीन पर सेट किया जाता है।)"],
  [{text:"केवल आज के अपलोड पर कार्य",opts:{bold:true,size:20}},{text:"चालू",opts:{bold:true,color:GREEN,size:20}},"प्रणाली केवल उसी दिन अपलोड किए गए लाभार्थियों पर कार्य करती है। पुरानी सूचियों से दोबारा संपर्क नहीं होता।"],
  [{text:"स्वतः सुरक्षा रोक",opts:{bold:true,size:20}},{text:"चालू",opts:{bold:true,color:GREEN,size:20}},"यदि खाते का बैलेंस समाप्त हो जाए, तो सभी कॉल एवं संदेश स्वतः रुक जाते हैं — एक अंतर्निहित सुरक्षा उपाय।"],
  [{text:"प्रति चक्र व्हाट्सएप",opts:{bold:true,size:20}},{text:"अधिकतम 25 संदेश",opts:{size:20}},"हर 5 मिनट में बैच में भेजे जाते हैं — मात्रा संतुलित और व्हाट्सएप सीमा के भीतर रहती है।"],
  [{text:"एक साथ कॉल",opts:{bold:true,size:20}},{text:"अधिकतम 3",opts:{size:20}},"कॉलिंग लाइन पर अधिक भार से बचाता है।"],
  [{text:"प्रसंस्करण आवृत्ति",opts:{bold:true,size:20}},{text:"हर 5 मिनट",opts:{size:20}},"प्रणाली कितनी बार कतार पर कार्य करती है।"],
  [{text:"व्हाट्सएप प्रेषक नंबर",opts:{bold:true,size:20}},{text:"+91 8808359820",opts:{size:20}},"सभी IEDUP व्हाट्सएप संदेश इसी नंबर से आते हैं।"],
]));
kids.push(pageBreak());

kids.push(banner(5,"फ़ोन कॉल — स्क्रिप्ट"));kids.push(spacer(120));
kids.push(para("",{after:140,runs:[run("एजेंट: ",{bold:true,size:22}),run("‘अंजली’ — एक सौम्य हिंदी आवाज़।  ",{size:22}),run("भाषा: ",{bold:true,size:22}),run("हिंदी (सामान्य अंग्रेज़ी शब्दों सहित)।  ",{size:22}),run("पूछे जाने पर वह बताती है कि वह एक AI है।",{size:22})]}));
kids.push(callout("कॉल की संरचना कैसी है",[
  bullet([run("AI पूरी सूचना एक ही शांत बातचीत में देती है — बीच में प्रश्नों से बाधा नहीं डालती।",{size:20})]),
  bullet([run("यह केवल दो प्रश्न पूछती है: आरंभ में (‘क्या मैं … से बात कर रही हूँ?’) और अंत में (‘और कुछ?’)।",{size:20})]),
  bullet([run("लाभार्थी के किसी भी प्रश्न का उत्तर 1–2 वाक्यों में देती है, फिर आगे बढ़ती है।",{size:20})]),
  bullet([run("यदि व्यक्ति धन्यवाद / ठीक है / और कुछ नहीं कहता, तो विदा लेती है। 8 सेकंड की चुप्पी पर भी विनम्रता से कॉल समाप्त करती है।",{size:20})]),
],CALLBLUE,PRIMARY));
kids.push(spacer(140));
kids.push(dataTable([{t:"चरण",w:26},{t:"AI क्या कहती है",w:74}],[
  [{text:"आरंभ (पहचान पुष्टि)",opts:{bold:true,size:20,color:PRIMARY}},{text:"नमस्ते, मैं IEDUP — उद्यमिता विकास संस्थान, लखनऊ से बात कर रही हूँ। क्या मैं [नाम] जी से बात कर रही हूँ?",opts:{size:20}}],
  [{text:"मुख्य संदेश (पूरी सूचना, एक ही बार)",opts:{bold:true,size:20,color:PRIMARY}},{text:"बहुत अच्छा। सबसे पहले, CM युवा योजना के तहत आपके loan की स्वीकृति पर हार्दिक बधाई। आपको सूचित करना है कि loan vitran से पहले 5 दिन का EDP प्रशिक्षण पूरा करना अनिवार्य है। यह प्रशिक्षण पूरी तरह online है, आप mobile, laptop, या computer से कर सकते हैं। मैं अभी आपको WhatsApp पर registration link भेज रही हूँ, कृपया आज ही register कर लीजिए। एक ज़रूरी बात — रजिस्ट्रेशन form में Applicant Code field में अपना CM युवा Application Number ज़रूर डालें।",opts:{size:20}}],
  [{text:"समापन",opts:{bold:true,size:20,color:PRIMARY}},{text:"और कुछ?  →  धन्यवाद, आपका दिन शुभ हो।",opts:{size:20}}],
]));
kids.push(pageBreak());

kids.push(banner(6,"कॉल प्रश्नोत्तर — AI क्या उत्तर देती है"));kids.push(spacer(120));
kids.push(para("यदि कोई लाभार्थी इनमें से कुछ पूछे, तो AI संक्षेप में (हिंदी में) उत्तर देती है और फिर आगे बढ़ती है।",{after:140}));
const qaHI=[
  ["आप कौन हैं?","मैं IEDUP, Government of Uttar Pradesh की तरफ़ से बात कर रही हूँ — यह CM युवा loan benefit के बारे में सूचना है।"],
  ["क्या आप AI हैं?","जी हाँ, मैं एक AI agent हूँ।"],
  ["कौन सा लिंक?","call के तुरंत बाद आपके WhatsApp पर link आ जाएगा।"],
  ["मैं अभी व्यस्त हूँ","कोई बात नहीं। मैं link WhatsApp पर भेज रही हूँ, time मिलते ही complete कर लीजिए।"],
  ["प्रशिक्षण कितने का है?","training की fee 1180 रुपये है, GST सहित।"],
  ["प्रशिक्षण कैसे होगा?","पूरी तरह online है, आप mobile, laptop, या computer से कर सकते हैं।"],
  ["क्या सिखाया जाएगा?","Business Management, Marketing, Finance, Government Schemes, और Entrepreneurship से जुड़े topics।"],
  ["कितने दिन?","5 दिन का प्रशिक्षण है, total 30 घंटे, daily maximum 6 घंटे।"],
  ["क्या टेस्ट होगा?","जी हाँ, 5 दिन की training के बाद online assessment है।"],
  ["प्रमाण पत्र कब?","assessment पूरा होने के बाद उसी portal पर मिल जाएगा।"],
  ["क्या मोबाइल से कर सकते हैं?","जी हाँ, किसी भी device से कर सकते हैं।"],
  ["इंटरनेट बंद हो जाए तो?","दोबारा login करके training जारी रख सकते हैं।"],
  ["पूरा नहीं किया तो?","यह अनिवार्य है, पूरी न करने पर loan process प्रभावित हो सकती है।"],
  ["मैंने पहले ही कर लिया","बहुत अच्छा, धन्यवाद।"],
  ["गलत व्यक्ति","माफ़ कीजिए, यह number [नाम] जी का है क्या?"],
  ["लॉगिन में समस्या","IEDUP helpdesk पर contact करें — 9369124402।"],
  ["मुझे कॉल न करें","बिल्कुल, माफ़ कीजिए। आपका नाम Do-Not-Call list में डाल दूंगी।"],
];
kids.push(dataTable([{t:"लाभार्थी पूछता है",w:34},{t:"AI का उत्तर",w:66}],
  qaHI.map(q=>[{text:q[0],opts:{bold:true,size:18,color:PRIMARY}},{text:q[1],opts:{size:20}}])));
kids.push(pageBreak());

kids.push(banner(7,"व्हाट्सएप संदेश"));kids.push(spacer(120));
kids.push(para("आप लाभार्थी पर जो एक्शन (Action) चुनते हैं, वही तय करता है कि कौन सा संदेश भेजा जाएगा। एक्शन के नाम ऐप में अंग्रेज़ी में दिखते हैं — नीचे पूरा मानचित्रण, फिर प्रत्येक संदेश विस्तार से।",{after:140}));
kids.push(dataTable([{t:"आप जो एक्शन चुनते हैं (ऐप में)",w:54},{t:"लाभार्थी को क्या मिलता है",w:46}],[
  [{text:"Call",opts:{bold:true,size:18}},{text:"अनिवार्य प्रशिक्षण के बारे में AI वॉइस कॉल (अंजली)",opts:{size:18}}],
  [{text:A_HELP,opts:{bold:true,size:18}},{text:"स्वागत + पंजीकरण लिंक + हेल्पडेस्क नंबर",opts:{size:18}}],
  [{text:A_REG,opts:{bold:true,size:18}},{text:"चरण-दर-चरण प्रशिक्षण निर्देश",opts:{size:18}}],
  [{text:A_PAY,opts:{bold:true,size:18}},{text:"भुगतान पुनः करने का अनुरोध",opts:{size:18}}],
  [{text:A_PHOTO,opts:{bold:true,size:18}},{text:"स्पष्ट फोटो पुनः भेजने का अनुरोध",opts:{size:18}}],
  [{text:A_CERT,opts:{bold:true,size:18}},{text:"प्रमाण पत्र डाउनलोड हेतु तैयार होने की सूचना",opts:{size:18}}],
]));
kids.push(spacer(160));
kids.push(new Paragraph({spacing:{after:60},children:[run("प्रत्येक संदेश पूर्ण रूप में",{bold:true,color:PRIMARY,size:24})]}));
msgCard(A_HELP,"कब उपयोग करें:","ऋण-स्वीकृत लाभार्थी का स्वागत करने और पंजीकरण लिंक भेजने के लिए (हेल्पडेस्क नंबर सहित)।",BODY_HELPDESK,"बटन:",["पंजीकरण करें  (Register)"]).forEach(b=>kids.push(b));
msgCard(A_REG,"कब उपयोग करें:","लाभार्थी द्वारा पंजीकरण एवं भुगतान के बाद — प्रशिक्षण की प्रक्रिया समझाता है।",BODY_REG,"बटन:",["लॉगिन करें (Login)"]).forEach(b=>kids.push(b));
msgCard(A_PAY,"कब उपयोग करें:","जब लाभार्थी का पंजीकरण भुगतान सफल न हो — पुनः प्रयास करने को कहता है।",BODY_PAY,"बटन:",["लॉगिन करें (Login)"]).forEach(b=>kids.push(b));
msgCard(A_PHOTO,"कब उपयोग करें:","जब प्रमाण पत्र हेतु अपलोड की गई फोटो उपयुक्त न हो — नई स्पष्ट फोटो माँगता है।",BODY_PHOTO,"बटन:",[]).forEach(b=>kids.push(b));
msgCard(A_CERT,"कब उपयोग करें:","जब लाभार्थी का प्रमाण पत्र तैयार हो — डाउनलोड करने की सूचना देता है।",BODY_CERT,"बटन:",["लॉगिन करें (Login)"]).forEach(b=>kids.push(b));
kids.push(pageBreak());

kids.push(banner(8,"स्थितियाँ जो आपको दिखेंगी"));kids.push(spacer(120));
kids.push(para("प्रत्येक लाभार्थी की स्थिति स्वतः अपडेट होती है — आप इन्हें हाथ से सेट नहीं करते।",{after:140}));
kids.push(dataTable([{t:"स्थिति",w:32},{t:"अर्थ",w:68}],[
  [{text:"कॉल किया गया (Call made)",opts:{bold:true,size:20,color:PRIMARY}},"इस लाभार्थी को AI वॉइस कॉल की गई।"],
  [{text:"संदेश भेजा गया (Message Sent)",opts:{bold:true,size:20,color:PRIMARY}},"व्हाट्सएप संदेश हमारी प्रणाली से लाभार्थी की ओर निकल गया।"],
  [{text:"संदेश डिलीवर हुआ (Delivered)",opts:{bold:true,size:20,color:PRIMARY}},"संदेश लाभार्थी के फोन तक पहुँच गया।"],
  [{text:"संदेश खोला गया (Opened)",opts:{bold:true,size:20,color:PRIMARY}},"लाभार्थी ने संदेश खोलकर पढ़ा।"],
]));
kids.push(pageBreak());

kids.push(banner(9,"त्वरित संदर्भ"));kids.push(spacer(120));
kids.push(dataTable([{t:"मद",w:34},{t:"विवरण",w:66}],[
  [{text:"हेल्पडेस्क फोन",opts:{bold:true,size:20}},{text:"9369124402",opts:{size:20}}],
  [{text:"हेल्पडेस्क ईमेल",opts:{bold:true,size:20}},{text:"cmyuvaiedup@gmail.com",opts:{size:20}}],
  [{text:"लाभार्थी पोर्टल",opts:{bold:true,size:20}},{text:"cmyuva.iedup.co.in  (login.php / registration_form.php)",opts:{size:20}}],
  [{text:"व्हाट्सएप प्रेषक नंबर",opts:{bold:true,size:20}},{text:"+91 8808359820",opts:{size:20}}],
  [{text:"प्रशिक्षण स्वरूप",opts:{bold:true,size:20}},{text:"5 दिन · कुल 30 घंटे · पूर्णतः ऑनलाइन · किसी भी डिवाइस से",opts:{size:20}}],
  [{text:"पंजीकरण सुझाव",opts:{bold:true,size:20}},{text:"फॉर्म के Applicant Code फ़ील्ड में अपना सीएम युवा Application Number दर्ज करें।",opts:{size:20}}],
]));
kids.push(spacer(160));
kids.push(callout("महत्वपूर्ण — दोहराव वाली कॉल/संदेश से बचें",[para("एक ही लाभार्थी को दोबारा एक्शन ट्रिगर करने के लिए दोबारा अपलोड न करें — प्रणाली फोन नंबर से डुप्लिकेट नहीं हटाती, इसलिए दोबारा अपलोड करने से डुप्लिकेट रिकॉर्ड बनते हैं जिनसे दोबारा संपर्क हो सकता है। हमेशा नई बैच ही अपलोड करें।",{after:0,runOpts:{size:20}})],CALLORANGE,ACCENT));

const doc=new Document({creator:"In-Sync",title:"IEDUP CM YUVA — User Guide (English + Hindi)",
  styles:{default:{document:{run:{font:FONT,size:22,color:"262626"}}}},
  sections:[{properties:{page:{margin:{top:1000,bottom:1000,left:1000,right:1000}}},children:kids}]});
Packer.toBuffer(doc).then(buf=>{fs.writeFileSync(process.argv[2],buf);console.log("WROTE",process.argv[2],buf.length,"bytes");}).catch(e=>{console.error("FAIL",e);process.exit(1);});

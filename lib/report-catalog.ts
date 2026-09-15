// Public report metadata only. Queries and authorization live in reports.ts.
export const reportCatalog = [
 {id:'leads',label:'العملاء والمصادر والمراحل',kind:'لقطة حالية للعملاء المنشئين في الفترة',note:'المراحل والتكليفات الحالية، وليست تحولات تاريخية أو معدل تحويل.',admin:false},
 {id:'followups',label:'مواعيد المتابعة',kind:'لقطة المواعيد الحالية خلال الفترة',note:'موعد المتابعة الحالي فقط؛ لا يوجد سجل مستقل لإنجاز كل موعد. المتأخر لا يشمل won وclosed.',admin:false},
 {id:'activity',label:'نشاط العملاء',kind:'أحداث حسب يوم الرياض (UTC+03) من TIMESTAMP المخزن',note:'نوع النشاط والفاعل فقط؛ لا تعرض الملاحظات. يفترض أن قيمة TIMESTAMP تمثل لحظة UTC قبل تحويل يوم التقرير إلى الرياض.',admin:false},
 {id:'properties',label:'العقارات والطلب المرتبط',kind:'كتالوج حالي + عملاء منشؤون في الفترة',note:'عدد الروابط يمثل طلبات العملاء وليس مبيعات أو إشغالاً. لا يوجد تاريخ حركة مخزون؛ أخرى والمعرفات غير الموجودة تظهر منفصلة.',admin:false},
 {id:'transactions',label:'المعاملات والمالية',kind:'لقطة آخر نسخة؛ الفترة حسب آخر تحديث UTC',note:'المستحق المؤكد: سداد الشركة + السعي، أو السعي فقط إذا سدد العميل. الحقول الأخرى إدخال يدوي وليست إيراداً محققاً. المجاميع مستقلة ولا تجمع الإجماليات مع مكوناتها؛ ليست دفتر تحصيل تاريخياً.',admin:true},
 {id:'attendance',label:'الحضور والساعات والتأخير',kind:'أحداث حسب يوم العمل المحلي المسجل',note:'الساعات من بصمات مكتملة فقط، دون خصم استراحات أو حساب أجور. التأخير مخزن وقت التسجيل. لا تسجيل لا يعني غياباً؛ لا أرشيف لتغيرات الدوام.',admin:false},
 {id:'profiles',label:'الملفات والأرصدة والدوام',kind:'لقطة حالية؛ لا يطبق نطاق التاريخ',note:'رصيد الإجازة يدوي؛ الاعتماد لا يخصمه آلياً. الدوام الحالي ليس تاريخياً. لا رواتب أو أرصدة سلف منظمة.',admin:false},
 {id:'requests',label:'طلبات الموظفين',kind:'طلبات أنشئت في الفترة UTC وحالتها الحالية',note:'يشمل الإجازات والإضافي والاستئذان وتصحيح البصمة والسلفة والمصروفات والعهدة ورحلة العمل والتأشيرة. لا احتساب مالي من نص الطلب ولا سجل تاريخي للحالة.',admin:false},
 {id:'announcements',label:'إعلانات الموظفين',kind:'أحداث نشر في الفترة UTC',note:'سجل نشر داخلي، لا إيصالات قراءة أو تسليم إشعارات مستقلة.',admin:false},
 {id:'users',label:'المستخدمون والأدوار',kind:'لقطة حسابات حالية؛ لا يطبق نطاق التاريخ',note:'الحسابات المحلية فقط. مدير Google لا يملك ملف موظف تلقائياً؛ لا سجل جلسات أو دخول كامل.',admin:true},
 {id:'audit',label:'تدقيق الإدارة والعمليات',kind:'أحداث مسجلة في الفترة UTC',note:'الفعل والفاعل والتاريخ فقط؛ لا تفاصيل أو مطالبات أو مفاتيح. ليس سجلاً شاملاً لكل تغيير مستخدم.',admin:true},
 {id:'imports',label:'تشغيلات الاستيراد',kind:'أحداث اعتماد الاستيراد في الفترة UTC',note:'سجل leads.import يحفظ عدد المقبول فقط وليس معرف دفعة مرتبطاً بكل صف. المعاينات والمرفوض والمكرر غير محفوظة تاريخياً.',admin:true},
 {id:'importRows',label:'الصفوف المستوردة',kind:'أحداث استيراد ناجحة في الفترة UTC',note:'روابط الصفوف المقبولة ومصدرها؛ لا عرض raw_data. نتائج الصفوف المرفوضة/المكررة متاحة وقت الاستيراد فقط.',admin:true},
 {id:'sheets',label:'صحة Google Sheets',kind:'آخر تشغيل محفوظ؛ لا يطبق نطاق التاريخ',note:'آخر نتيجة فقط، لا سجل تشغيلات أو إثبات أن المجدول يعمل. لا عرض الإعداد أو عنوان المستند أو أسرار الخدمة.',admin:true},
 {id:'ai',label:'استخدام AI',kind:'محاولات حسب الساعة UTC في الفترة',note:'عداد محاولات الطلبات، وليس نجاحاً أو استهلاك رموز أو تكلفة. سجل العملية في التدقيق؛ لا أسئلة أو مفاتيح أو إجابات.',admin:true},
] as const;
export type ReportId=typeof reportCatalog[number]['id'];
export type ReportCell=string|number|null;
export type ReportRow=Record<string,ReportCell>;
export type ReportColumn={key:string;label:string};
export type ReportResult={id:string;label:string;kind:string;note:string;columns:ReportColumn[];rows:ReportRow[];total:number;page:number;pageSize:number;groups:Record<string,{label:string;count:number}[]>;metrics:{label:string;value:ReportCell;missing?:number}[];generatedAt:string};
export function allowedReports(role:string){return reportCatalog.filter(r=>role==='admin'||!r.admin);}

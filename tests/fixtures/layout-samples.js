// tests/fixtures/layout-samples.js
// Fixed sample translations for all 20 languages, used by the unit tests and by the browser
// check that renders the overlay in headless Edge. No Gemini call is needed for them.
//
// The English form (SOURCE) has five blocks:
//   title   - big heading
//   long    - a long line
//   email   - a label with an e-mail address
//   time    - opening hours with AM / PM (the time words are already translated here)
//   button  - one short word on a button
// Every language gives the translation of each block in its own script. Numbers, the e-mail
// address and the times stay as printed.

export const SOURCE = {
  title: 'Account Application Form',
  long: 'Please check your details carefully before you send the form.',
  email: 'Email: john.doe@example.com',
  time: 'Open 10:30 AM - 5:00 PM',
  button: 'Submit',
};

// Order of the blocks in every sample list.
export const KEYS = ['title', 'long', 'email', 'time', 'button'];

export const SAMPLES = {
  en: { bcp47: 'en-US', title: 'Account Request Form', long: 'Check all your details carefully before sending this form.', email: 'E-mail: john.doe@example.com', time: 'Open 10:30 a.m. - 5:00 p.m.', button: 'Send' },
  ta: { bcp47: 'ta-IN', title: 'கணக்கு விண்ணப்பப் படிவம்', long: 'படிவத்தை அனுப்புவதற்கு முன் உங்கள் விவரங்களை கவனமாகச் சரிபார்க்கவும்.', email: 'மின்னஞ்சல்: john.doe@example.com', time: 'திறந்திருக்கும் முற்பகல் 10:30 - பிற்பகல் 5:00', button: 'சமர்ப்பிக்கவும்' },
  hi: { bcp47: 'hi-IN', title: 'खाता आवेदन फ़ॉर्म', long: 'फ़ॉर्म भेजने से पहले अपने विवरण ध्यान से जाँच लें।', email: 'ईमेल: john.doe@example.com', time: 'खुला पूर्वाह्न 10:30 - अपराह्न 5:00', button: 'जमा करें' },
  te: { bcp47: 'te-IN', title: 'ఖాతా దరఖాస్తు ఫారమ్', long: 'ఫారమ్‌ను పంపే ముందు మీ వివరాలను జాగ్రత్తగా తనిఖీ చేయండి.', email: 'ఈమెయిల్: john.doe@example.com', time: 'తెరిచి ఉంటుంది పూర్వాహ్నం 10:30 - అపరాహ్నం 5:00', button: 'సమర్పించండి' },
  kn: { bcp47: 'kn-IN', title: 'ಖಾತೆ ಅರ್ಜಿ ನಮೂನೆ', long: 'ಫಾರ್ಮ್ ಕಳುಹಿಸುವ ಮೊದಲು ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಎಚ್ಚರಿಕೆಯಿಂದ ಪರಿಶೀಲಿಸಿ.', email: 'ಇಮೇಲ್: john.doe@example.com', time: 'ತೆರೆದಿರುತ್ತದೆ ಪೂರ್ವಾಹ್ನ 10:30 - ಅಪರಾಹ್ನ 5:00', button: 'ಸಲ್ಲಿಸಿ' },
  ml: { bcp47: 'ml-IN', title: 'അക്കൗണ്ട് അപേക്ഷാ ഫോം', long: 'ഫോം അയയ്ക്കുന്നതിന് മുമ്പ് നിങ്ങളുടെ വിവരങ്ങൾ ശ്രദ്ധയോടെ പരിശോധിക്കുക.', email: 'ഇമെയിൽ: john.doe@example.com', time: 'തുറന്നിരിക്കും പൂർവാഹ്നം 10:30 - അപരാഹ്നം 5:00', button: 'സമർപ്പിക്കുക' },
  ko: { bcp47: 'ko-KR', title: '계좌 신청서', long: '양식을 보내기 전에 정보를 꼼꼼히 확인하세요.', email: '이메일: john.doe@example.com', time: '영업시간 오전 10:30 - 오후 5:00', button: '제출' },
  zh: { bcp47: 'zh-CN', title: '账户申请表', long: '发送表格之前，请仔细检查您的信息。', email: '电子邮件：john.doe@example.com', time: '营业时间 上午 10:30 - 下午 5:00', button: '提交' },
  ja: { bcp47: 'ja-JP', title: '口座申込フォーム', long: 'フォームを送信する前に、入力内容をよく確認してください。', email: 'メール：john.doe@example.com', time: '営業時間 午前 10:30 - 午後 5:00', button: '送信' },
  es: { bcp47: 'es-ES', title: 'Formulario de solicitud de cuenta', long: 'Revise con cuidado sus datos antes de enviar el formulario.', email: 'Correo: john.doe@example.com', time: 'Abierto 10:30 a. m. - 5:00 p. m.', button: 'Enviar' },
  fr: { bcp47: 'fr-FR', title: 'Formulaire de demande de compte', long: "Vérifiez attentivement vos informations avant d'envoyer le formulaire.", email: 'E-mail : john.doe@example.com', time: "Ouvert 10:30 du matin - 5:00 de l'après-midi", button: 'Envoyer' },
  ar: { bcp47: 'ar-SA', title: 'نموذج طلب حساب', long: 'يرجى مراجعة بياناتك بعناية قبل إرسال النموذج.', email: 'البريد الإلكتروني: john.doe@example.com', time: 'مفتوح 10:30 ص - 5:00 م', button: 'إرسال' },
  pt: { bcp47: 'pt-BR', title: 'Formulário de pedido de conta', long: 'Confira seus dados com atenção antes de enviar o formulário.', email: 'E-mail: john.doe@example.com', time: 'Aberto 10:30 AM - 5:00 PM', button: 'Enviar' },
  ru: { bcp47: 'ru-RU', title: 'Заявление на открытие счёта', long: 'Внимательно проверьте свои данные перед отправкой формы.', email: 'Эл. почта: john.doe@example.com', time: 'Открыто 10:30 до полудня - 5:00 после полудня', button: 'Отправить' },
  bn: { bcp47: 'bn-IN', title: 'অ্যাকাউন্ট আবেদন ফর্ম', long: 'ফর্ম পাঠানোর আগে আপনার তথ্য ভালো করে দেখে নিন।', email: 'ইমেইল: john.doe@example.com', time: 'খোলা পূর্বাহ্ণ 10:30 - অপরাহ্ণ 5:00', button: 'জমা দিন' },
  ur: { bcp47: 'ur-PK', title: 'اکاؤنٹ درخواست فارم', long: 'فارم بھیجنے سے پہلے اپنی معلومات احتیاط سے جانچ لیں۔', email: 'ای میل: john.doe@example.com', time: 'کھلا صبح 10:30 - شام 5:00', button: 'جمع کرائیں' },
  id: { bcp47: 'id-ID', title: 'Formulir Permohonan Akun', long: 'Periksa data Anda dengan teliti sebelum mengirim formulir ini.', email: 'Email: john.doe@example.com', time: 'Buka 10:30 AM - 5:00 PM', button: 'Kirim' },
  de: { bcp47: 'de-DE', title: 'Antragsformular für ein Konto', long: 'Prüfen Sie Ihre Angaben sorgfältig, bevor Sie das Formular absenden.', email: 'E-Mail: john.doe@example.com', time: 'Geöffnet 10:30 AM - 5:00 PM', button: 'Absenden' },
  vi: { bcp47: 'vi-VN', title: 'Mẫu đơn đăng ký tài khoản', long: 'Hãy kiểm tra kỹ thông tin của bạn trước khi gửi biểu mẫu.', email: 'Email: john.doe@example.com', time: 'Mở cửa 10:30 SA - 5:00 CH', button: 'Gửi' },
  tr: { bcp47: 'tr-TR', title: 'Hesap Başvuru Formu', long: 'Formu göndermeden önce bilgilerinizi dikkatle kontrol edin.', email: 'E-posta: john.doe@example.com', time: 'Açık 10:30 ÖÖ - 5:00 ÖS', button: 'Gönder' },
};

// A sample in a language without spaces that is NOT one of the 20 (the code supports it).
export const THAI_SAMPLE = {
  bcp47: 'th-TH',
  long: 'กรุณาตรวจสอบข้อมูลของคุณก่อนส่งแบบฟอร์ม',
};

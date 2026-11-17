# Requirements Document

## Introduction

Phantom Voice Kit is a reusable skeleton for voice-first web applications with a spooky Halloween theme. It provides shared infrastructure for speech input, speech output, language selection, dual-language display, and an AI backend. Two applications are built on this skeleton:

- **Spirit Clerk** — helps a user fill any form by speaking.
- **Ghost Tutor** — helps a user learn a topic through spoken dialogue with a voice tutor.

---

## Glossary

- **Locale_File**: A JSON file in `skeleton/locales/` (one per supported language, named by the language code, e.g. `ta.json`) that maps UI string keys to translated text.
- **Navigation_Header**: The shared top header bar rendered by the skeleton on every page, containing the menu button, the Back button, and the language dropdown.
- **System**: The Phantom Voice Kit application, including both Spirit Clerk and Ghost Tutor apps and the shared skeleton.
- **Skeleton**: The shared template and infrastructure used by both Spirit Clerk and Ghost Tutor.
- **Spirit_Clerk**: The form-filling application built on the Skeleton.
- **Ghost_Tutor**: The voice-based learning application built on the Skeleton.
- **AI_Backend**: The Node.js server that communicates with the Google Gemini API on behalf of the browser clients.
- **Speech_Input**: The browser's speech recognition capability used to capture spoken user input.
- **Speech_Output**: The browser's speech synthesis capability used to speak text aloud to the user.
- **Heard_Text**: The transcription of what the user spoke, displayed in the user's chosen language.
- **English_Meaning**: The English translation of the Heard_Text, displayed alongside it.
- **Chosen_Language**: The language selected by the user from the language dropdown.
- **Form_Image**: A PDF or photo of a form uploaded by the user in Spirit Clerk.
- **Form_Field**: A single input field extracted from a Form_Image by the AI_Backend.
- **Field_Answer**: The user's spoken or typed response to a Form_Field question.
- **Filled_Summary**: A structured display of all Form_Fields and their confirmed Field_Answers.
- **Topic**: A subject chosen or typed by the user in Ghost Tutor.
- **Lesson_Segment**: A short spoken explanation delivered by Ghost_Tutor on one aspect of the Topic.
- **Quiz_Question**: A question asked by Ghost_Tutor after a Lesson_Segment to check understanding.
- **Feedback**: Ghost_Tutor's spoken evaluation of the user's answer to a Quiz_Question.
- **Text_Fallback**: A text input box available as an alternative to speaking.
- **Voice_Command**: A short spoken word such as yes or again that the System recognises to confirm or redo.
- **Field_Help**: A short, simple sentence in the Chosen_Language, returned by the AI_Backend for a Form_Field, that explains what the field means with a small example.

---

## Requirements

### Requirement 1: Language Selection

**User Story:** As a user, I want to pick my preferred language before interacting with the app, so that all voice input and voice output happen in a language I understand.

#### Acceptance Criteria

1. WHEN the application loads, THE Skeleton SHALL display a language dropdown containing these 20 languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Korean, Chinese (Simplified), Japanese, Spanish, French, Arabic, Portuguese (Brazil), Russian, Bengali, Urdu, Indonesian, German, Vietnamese, and Turkish, with English pre-selected as the default.
2. WHEN the user selects a language from the dropdown, THE Skeleton SHALL apply the Chosen_Language to all subsequent Speech_Input and Speech_Output in that session and reflect the active selection visibly in the dropdown.
3. WHEN the user changes the Chosen_Language mid-session, THE Skeleton SHALL update Speech_Input and Speech_Output to the new Chosen_Language after any in-progress Speech_Output has completed.

---

### Requirement 2: Speech Input

**User Story:** As a user, I want to speak my answers instead of typing, so that I can interact hands-free.

#### Acceptance Criteria

1. WHEN the user activates the microphone control, THE Speech_Input SHALL begin capturing spoken audio in the Chosen_Language and continue capturing until the user deactivates the microphone control or 30 seconds of continuous silence is detected.
2. WHEN Speech_Input captures spoken audio, THE Skeleton SHALL display the Heard_Text in the Chosen_Language on screen within 3 seconds of speech capture completing.
3. IF the Chosen_Language is not English, WHEN Speech_Input produces Heard_Text, THE Skeleton SHALL request a translation from the AI_Backend and display the English_Meaning alongside the Heard_Text within 5 seconds of the translation request being sent.
4. IF Speech_Input fails to capture audio or returns an empty result after the capture session ends, THEN THE Skeleton SHALL display an error message indicating the failure, prompt the user to try again or use the Text_Fallback, and allow no more than 3 retry attempts before presenting only the Text_Fallback option.
5. IF the AI_Backend fails to return a translation within 5 seconds or returns an error, THEN THE Skeleton SHALL display an error message indicating the translation is unavailable and present the Heard_Text without the English_Meaning.
6. IF the browser does not support SpeechRecognition, THEN THE Skeleton SHALL hide the microphone control, display a short message that voice input is not available in this browser, and accept answers through the Text_Fallback only.

---

### Requirement 3: Speech Output

**User Story:** As a user, I want the app to speak to me in my chosen language, so that I can understand questions and feedback without reading.

#### Acceptance Criteria

1. WHEN the System generates a message to deliver to the user, THE Speech_Output SHALL speak the message aloud in the Chosen_Language.
2. WHILE Speech_Output is speaking, THE Skeleton SHALL display the spoken text on screen within 500 milliseconds of the audio starting, and SHALL keep the text visible until the next message begins or the user dismisses it.
3. IF Speech_Output is unavailable in the Chosen_Language, THEN THE Skeleton SHALL display the message text on screen and display an inline message indicating that audio is unavailable for the selected language.
4. IF Speech_Output fails after audio has started, THEN THE Speech_Output SHALL stop and THE Skeleton SHALL display the remaining unspoken text and an inline message indicating that audio was interrupted.
5. WHEN more than one installed voice matches the Chosen_Language, THE Speech_Output SHALL prefer a voice whose name contains "Natural", then a voice whose name contains "Online", then the first matching voice.

---

### Requirement 4: Dual Display

**User Story:** As a user, I want to see both what the app heard in my language and its English meaning, so that I can verify the app understood me correctly.

#### Acceptance Criteria

1. WHEN Heard_Text is available, THE Skeleton SHALL display the Heard_Text and the English_Meaning together on the same screen at the same time.
2. THE Skeleton SHALL visually distinguish the Heard_Text from the English_Meaning by rendering them in separate labeled sections, each with a visible heading identifying which language the text belongs to.
3. IF Heard_Text is available but the English_Meaning is not available (due to translation failure or Chosen_Language being English), THEN THE Skeleton SHALL display only the Heard_Text and indicate that the English_Meaning is unavailable.
4. IF Heard_Text is empty (zero characters), THEN THE Skeleton SHALL not display the dual-display area.

---

### Requirement 5: Text Fallback

**User Story:** As a user, I want to type my answer when I cannot or do not want to speak, so that I can still complete the task.

#### Acceptance Criteria

1. WHILE a screen that accepts a spoken answer is displayed, THE Skeleton SHALL display a Text_Fallback input box accepting up to 500 characters.
2. WHEN the user submits a non-empty, non-whitespace text entry via the Text_Fallback by pressing the submit button or the Enter key, THE Skeleton SHALL process the submission through the same validation and progression steps as a spoken answer.
3. IF the user attempts to submit an empty or whitespace-only entry via the Text_Fallback, THEN THE Skeleton SHALL display an inline validation message and not advance the flow.
4. WHEN the user submits a valid Text_Fallback entry, THE Skeleton SHALL request a translation from the AI_Backend and display the English_Meaning in the same view as the submitted text within 5 seconds of the translation request being sent.
5. IF the AI_Backend fails to return a translation within 5 seconds or returns an error, THEN THE Skeleton SHALL display an inline error message indicating translation is unavailable and preserve the submitted text on screen without clearing the user's input.

---

### Requirement 6: Spooky Halloween UI

**User Story:** As a user, I want a fun, themed interface, so that the app feels festive and engaging.

#### Acceptance Criteria

1. THE Skeleton SHALL apply a ghost and Halloween visual theme consistently across all screens of Spirit Clerk and Ghost Tutor, including typography, iconography, background, and color palette.
2. WHEN the Skeleton is rendered on a mobile device with a screen width between 320px and 767px, THE Skeleton SHALL display all content without horizontal scrolling and with touch targets of at least 44x44 pixels.
3. THE Skeleton SHALL display all interactive controls at a minimum size of 44x44 pixels on mobile screen widths between 320px and 767px.
4. IF the Skeleton cannot load a Halloween theme asset (such as a font, icon, or background image), THEN THE Skeleton SHALL fall back to a default styled element that preserves layout integrity without displaying a broken or missing asset indicator.

---

### Requirement 7: AI Backend

**User Story:** As a developer, I want all AI API calls to go through a backend server, so that API keys are never exposed in the browser.

#### Acceptance Criteria

1. THE AI_Backend SHALL handle all requests to the Google Gemini API on behalf of the browser client.
2. THE System SHALL never include any Google Gemini API key in code, HTML, or JavaScript bundles delivered to the browser.
3. WHEN the browser client needs a translation, field extraction, question generation, or lesson content, THE AI_Backend SHALL receive the request, call the Google Gemini API within 30 seconds, and return the result payload to the browser client.
4. IF the AI_Backend receives an error response from the Google Gemini API, THEN THE AI_Backend SHALL return a descriptive error to the browser client that does not expose the API key or internal server details.
5. IF the Google Gemini API does not respond within 30 seconds, THEN THE AI_Backend SHALL return a timeout error response to the browser client.
6. IF the AI_Backend receives a request with empty or invalid input, THEN THE AI_Backend SHALL return a validation error response to the browser client without calling the Google Gemini API.

---

### Requirement 8: Form Upload (Spirit Clerk)

**User Story:** As a user, I want to upload a form as a PDF or photo, so that the app can read it and guide me through filling it in.

#### Acceptance Criteria

1. THE Spirit_Clerk SHALL provide a file upload control that accepts PDF and common image formats (JPEG, PNG, WEBP) and rejects files exceeding 10 MB before upload begins.
2. WHEN the user uploads a Form_Image, THE Spirit_Clerk SHALL send it to the AI_Backend for field extraction within 2 seconds of the user confirming the upload.
3. WHEN the AI_Backend receives a Form_Image, THE AI_Backend SHALL use the Google Gemini API to identify and return all Form_Fields present in the form, where each Form_Field includes at minimum a label and an input type (text, date, checkbox, or selection).
4. IF the uploaded file is not a supported format (PDF, JPEG, PNG, WEBP) or exceeds the 10 MB size limit, THEN THE Spirit_Clerk SHALL display an error message indicating the reason and prompt the user to upload a different file without clearing any previously filled form data.
5. IF the Google Gemini API returns an error or does not respond within 30 seconds, THEN THE AI_Backend SHALL return an error response to the Spirit_Clerk, and THE Spirit_Clerk SHALL display an error message indicating that field extraction failed and allow the user to retry the upload.
6. IF the Google Gemini API returns zero Form_Fields from the uploaded Form_Image, THEN THE Spirit_Clerk SHALL display a message indicating that no fields were detected and prompt the user to upload a clearer image or a different file.

---

### Requirement 9: Guided Form Filling (Spirit Clerk)

**User Story:** As a user, I want the app to ask me about each form field by voice, so that I can answer one question at a time without reading the form myself.

#### Acceptance Criteria

1. WHEN Form_Fields have been extracted, THE Spirit_Clerk SHALL ask the user about each Form_Field in the order they appear in the source document (top-to-bottom, left-to-right) using Speech_Output in the Chosen_Language.
2. WHEN the AI_Backend generates a spoken question for a Form_Field, THE AI_Backend SHALL produce a short, friendly question in the Chosen_Language based on the Form_Field label, regardless of the language the form itself is written in.
3. WHEN the user provides a Field_Answer by speaking or via Text_Fallback, THE Spirit_Clerk SHALL display the Heard_Text alongside its English translation and ask the user to confirm or redo the answer before proceeding to the next Form_Field.
4. WHEN the user requests to redo a Field_Answer, THE Spirit_Clerk SHALL re-ask the same Form_Field question and accept a new answer, allowing up to 3 redo attempts per Form_Field before marking the field as skipped and proceeding to the next Form_Field.
5. IF the Spirit_Clerk receives no spoken input and no Text_Fallback within 30 seconds of asking a Form_Field question, THEN THE Spirit_Clerk SHALL prompt the user once more; IF no input is received within a further 30 seconds, THEN THE Spirit_Clerk SHALL mark the field as skipped and proceed to the next Form_Field.
6. WHEN all Form_Fields have been either confirmed or marked as skipped, THE Spirit_Clerk SHALL advance to the Filled_Summary screen, indicating the count of skipped fields if any fields were skipped.

---

### Requirement 10: Filled Summary and PDF Download (Spirit Clerk)

**User Story:** As a user, I want to see all my answers together and download them as a PDF, so that I have a record of what I filled in.

#### Acceptance Criteria

1. THE Spirit_Clerk SHALL display the Filled_Summary showing each Form_Field label paired with its confirmed Field_Answer in English, presented in the same order the fields appeared during the conversation.
2. THE Spirit_Clerk SHALL provide a download control that generates and saves the Filled_Summary as a PDF file to the user's device, with the filename containing the form name and the date the summary was generated.
3. WHEN the user activates the download control, THE Spirit_Clerk SHALL produce a PDF containing all Form_Field labels and their confirmed Field_Answers, with one label-answer pair per line and a maximum of 200 Form_Field entries per PDF.
4. IF the PDF generation fails, THEN THE Spirit_Clerk SHALL display an error message indicating the download could not be completed and retain the Filled_Summary on screen so the user's answers are not lost.

---

### Requirement 11: Topic Selection (Ghost Tutor)

**User Story:** As a user, I want to pick or type a topic I want to learn about, so that the tutor can teach me something relevant.

#### Acceptance Criteria

1. THE Ghost_Tutor SHALL provide a topic selection screen where the user can either choose from a list of 5 to 20 suggested topics or type a custom Topic of 1 to 100 characters.
2. WHEN the user confirms a non-empty Topic, THE Ghost_Tutor SHALL display a loading indicator and send the Topic to the AI_Backend to generate the first Lesson_Segment.
3. IF the user attempts to confirm an empty or whitespace-only Topic, THEN THE Ghost_Tutor SHALL display an inline validation message and not send the request to the AI_Backend.
4. IF the AI_Backend does not return the first Lesson_Segment within 25 seconds, THEN THE Ghost_Tutor SHALL display an error message indicating the content could not be loaded and preserve the Topic selection so the user can retry without re-entering the Topic.

---

### Requirement 12: Lesson Delivery (Ghost Tutor)

**User Story:** As a user, I want the tutor to explain topics in short spoken pieces and ask me questions, so that I can learn at a comfortable pace.

#### Acceptance Criteria

1. WHEN a Lesson_Segment is ready, THE Ghost_Tutor SHALL deliver it to the user using Speech_Output in the Chosen_Language and display the transcript text on screen within 500 milliseconds of audio playback start.
2. WHEN a Lesson_Segment has been delivered, THE Ghost_Tutor SHALL ask a Quiz_Question by voice in the Chosen_Language, display the Quiz_Question text on screen, and wait up to 30 seconds for the user's answer.
3. IF the user does not provide an answer within 30 seconds of the Quiz_Question being asked, THEN THE Ghost_Tutor SHALL re-ask the same Quiz_Question once and reset the 30-second answer wait period.
4. WHEN the user answers a Quiz_Question by speaking or via Text_Fallback, THE Ghost_Tutor SHALL display the Heard_Text and the English_Meaning and send the answer to the AI_Backend for evaluation.
5. IF speech input is received but no Heard_Text can be produced, THEN THE Ghost_Tutor SHALL prompt the user to repeat their answer using Speech_Output in the Chosen_Language and allow one additional 30-second answer attempt.
6. WHEN the AI_Backend returns an evaluation, THE Ghost_Tutor SHALL deliver Feedback to the user using Speech_Output in the Chosen_Language and display the Feedback text on screen.
7. IF the AI_Backend does not return an evaluation within 10 seconds of the answer being sent, THEN THE Ghost_Tutor SHALL display an error message indicating the evaluation could not be retrieved and re-ask the same Quiz_Question.
8. WHEN Feedback has been delivered and a next Lesson_Segment exists on the same Topic, THE Ghost_Tutor SHALL proceed to that next Lesson_Segment.
9. WHEN Feedback has been delivered and no further Lesson_Segments exist on the same Topic, THE Ghost_Tutor SHALL notify the user using Speech_Output in the Chosen_Language that the Topic is complete and display a completion message on screen.


---

### Requirement 13: Home Screen

**User Story:** As a user, I want to see a home screen when the app opens so that I can choose between Spirit Clerk and Ghost Tutor and set my language in one place.

#### Acceptance Criteria

1. WHEN the application loads, THE System SHALL display a home screen containing the language dropdown, a "Spirit Clerk" button, and a "Ghost Tutor" button.
2. WHEN the user selects a language on the home screen and then opens an app, THE System SHALL carry the Chosen_Language into Spirit Clerk or Ghost Tutor without requiring the user to select it again.
3. WHEN the user activates the "Spirit Clerk" button, THE System SHALL navigate to the Spirit Clerk upload screen.
4. WHEN the user activates the "Ghost Tutor" button, THE System SHALL navigate to the Ghost Tutor topic selection screen.
5. THE Spirit_Clerk SHALL provide a way to navigate back to the home screen through the Navigation_Header defined in Requirement 16 (the "Home" link in the menu drawer and the Back button).
6. THE Ghost_Tutor SHALL provide a way to navigate back to the home screen through the Navigation_Header defined in Requirement 16 (the "Home" link in the menu drawer and the Back button).
7. THE home screen SHALL apply the same ghost and Halloween visual theme as defined in Requirement 6.
8. WHEN the home screen is displayed, THE System SHALL show a short tip reading "For the best voices in Indian languages, open this app in Microsoft Edge."

---

### Requirement 14: Skeleton Template Structure

**User Story:** As a developer, I want a clearly separated skeleton folder so that I can build a new voice app by importing from the skeleton without copying its code.

#### Acceptance Criteria

1. THE System SHALL organise all shared code — including Speech_Input, Speech_Output, language dropdown, dual display, Text_Fallback, Halloween theme, and AI_Backend client — into a single skeleton folder that contains no Spirit Clerk or Ghost Tutor specific logic.
2. THE Spirit_Clerk and THE Ghost_Tutor SHALL each reside in a separate app folder and SHALL import shared components from the skeleton folder rather than duplicating skeleton code.
3. THE System SHALL include a README file in the skeleton folder that describes in plain numbered steps how a developer creates a new voice app using the skeleton, covering: creating a new app folder next to the existing apps, registering a new app folder, and connecting to the AI_Backend.
4. IF a developer modifies a shared component in the skeleton folder, THEN that change SHALL take effect in both Spirit Clerk and Ghost Tutor without requiring changes to the individual app folders.

---

### Requirement 15: Open Source

**User Story:** As a contributor, I want the project to be clearly open source so that anyone can use, modify, and share the code.

#### Acceptance Criteria

1. THE System SHALL include an MIT License file named LICENSE at the root of the repository.
2. THE LICENSE file SHALL contain the standard MIT License text with the copyright year and author name filled in.
3. THE repository's .gitignore file SHALL NOT exclude the .kiro folder, so that spec and configuration files are committed alongside the source code.

---

### Requirement 16: Navigation

**User Story:** As a user, I want a menu and a Back button on every screen, so that I can move between the apps and return to earlier screens without getting lost.

#### Acceptance Criteria

1. THE System SHALL provide one shared navigation module in the skeleton folder that renders the Navigation_Header on the home screen, Spirit Clerk, and Ghost Tutor, with a menu (hamburger) button on the left, a "← Back" button next to it, and the language dropdown on the right.
2. WHEN the user activates the menu button, THE Navigation_Header SHALL open a side drawer that slides in from the left (from the right in right-to-left languages, see Requirement 17.8) and lists three links: "Home" (`/`), "Spirit Clerk" (`/apps/spirit-clerk/index.html`), and "Ghost Tutor" (`/apps/ghost-tutor/index.html`).
3. THE drawer SHALL highlight the link for the current page and mark it with `aria-current="page"`.
4. THE menu button SHALL set `aria-expanded` to `true` while the drawer is open and `false` while it is closed, and SHALL have an `aria-label` that describes its action.
5. WHEN the user activates a drawer link, clicks outside the drawer, or presses the Escape key, THE Navigation_Header SHALL close the drawer.
6. WHEN the user activates the Back button AND the current app has a previous screen in its screen history, THE System SHALL return to that previous screen inside the app.
7. WHEN the user activates the Back button on the first screen of an app, THE System SHALL navigate to the home screen (`/`).
8. WHILE the home screen is displayed, THE Navigation_Header SHALL show the menu button and SHALL hide the Back button.
9. WHEN the user tries to leave the Spirit Clerk form-fill screen before all fields are processed (by the Back button or by a drawer link), THE System SHALL ask for confirmation with the text "Your answers will be lost. Go back?" and SHALL leave the screen only if the user confirms.
10. WHEN the user navigates away from a page or screen using the Navigation_Header, THE System SHALL stop any Speech_Output in progress.
11. THE Navigation_Header SHALL apply the Halloween theme defined in Requirement 6, SHALL make every control at least 44×44 px, and SHALL not cause horizontal overflow on viewport widths from 320 px to 767 px.

---

### Requirement 17: Localization

**User Story:** As a user who cannot read English, I want every button, label, and message in the app to appear in my chosen language, so that I can use the app without understanding English.

#### Acceptance Criteria

1. THE language dropdown SHALL list each of the 20 supported languages by its own name in its own script followed by the English name in parentheses, for example "தமிழ் (Tamil)", "हिन्दी (Hindi)", and "中文 (Chinese)".
2. THE System SHALL store every fixed UI string used on the home screen, the Navigation_Header, Spirit Clerk, and Ghost Tutor (titles, buttons, labels, placeholders, tips, aria-labels, confirmation dialogs, error messages, status messages, spoken voice prompts, and the Voice_Command word lists) in Locale_Files, with `skeleton/locales/en.json` as the source of truth and one Locale_File for each of the other 19 languages.
3. THE skeleton SHALL provide an i18n module that exposes `t(key)`, loads `/skeleton/locales/<code>.json` on demand, caches each loaded file, and falls back to the English text for any key that is missing in the chosen language.
4. THE i18n module SHALL translate elements marked with `data-i18n` attributes (text, and attributes such as `aria-label` and `placeholder`) when `applyTranslations(root)` is called.
5. WHEN the user changes the Chosen_Language, THE System SHALL update all visible text, aria-labels, placeholders, and dialog messages to that language immediately, without reloading the page.
6. WHEN a page loads, THE System SHALL display the UI in the language stored in `sessionStorage.chosenLang`, or in English if none is stored.
7. THE System SHALL set the `lang` attribute of the `<html>` element to the Chosen_Language code, and SHALL set `dir="rtl"` for Arabic and Urdu and `dir="ltr"` for all other languages.
8. WHILE the layout direction is right-to-left, THE System SHALL mirror the layout using CSS logical properties, and THE Navigation_Header drawer SHALL slide in from the right.
9. THE text of the PDF summary SHALL always be in English, regardless of the Chosen_Language, and form labels, answers, and AI-generated text SHALL NOT be treated as UI strings.
10. EVERY Locale_File SHALL contain exactly the same keys as `en.json` and SHALL contain no empty values.
11. WHEN `skeleton/locales/en.json` is saved, THE System SHALL run a Kiro agent hook that adds new or changed keys to the other 19 Locale_Files with natural translations, removes keys that no longer exist in `en.json`, and never renames keys.

---

### Requirement 18: Voice Commands

**User Story:** As a user who cannot easily use buttons or type, I want to say a short word such as "yes" or "again" to confirm or redo my answer, so that I can complete the whole flow by voice alone.

#### Acceptance Criteria

1. THE Skeleton SHALL provide a shared module `skeleton/voice-commands.js` that exports a pure function `matchCommand(text, words)` returning `"yes"`, `"redo"`, or `null`, where `words` is an object `{ yes: string[], redo: string[] }`.
2. THE System SHALL build `words` from the Locale_File keys `voice.yesWords` and `voice.redoWords`, each holding a "|"-separated list of short words in that language (for example English `yes|ok|correct` and `again|no|redo`; Tamil `சரி|ஆமாம்|ஓகே` and `மறுபடி|இல்லை|திரும்ப`), and every Locale_File SHALL contain both keys.
3. WHEN `matchCommand` compares an utterance with the word lists, THE Skeleton SHALL ignore letter case, punctuation (including `।`, `。`, `،`, and `؟`), and extra whitespace.
4. WHEN the cleaned utterance equals a word in a list, or consists only of repetitions of one word from a list (for example "yes yes"), THE Skeleton SHALL return the command of that list.
5. IF the cleaned utterance matches a word in both lists, THEN THE Skeleton SHALL return `null`; IF it matches no word, or is empty, THEN THE Skeleton SHALL also return `null`.
6. WHEN Spirit_Clerk has shown the Heard_Text and the English_Meaning of a Field_Answer, THE Spirit_Clerk SHALL ask by voice in the Chosen_Language "Is this correct? Say yes, or say again." and listen once for a Voice_Command.
7. WHEN the Voice_Command heard is "yes", THE Spirit_Clerk SHALL act as if the user pressed Confirm; WHEN it is "redo", THE Spirit_Clerk SHALL act as if the user pressed Redo.
8. IF the user says anything else, or says nothing, THEN THE Spirit_Clerk SHALL leave the Confirm and Redo buttons waiting for the user.
9. THE Confirm and Redo buttons SHALL keep working at all times, and a spoken Voice_Command SHALL never be stored as a Field_Answer.
10. THE Ghost_Tutor SHALL use the same "yes" Voice_Command for the topic confirmation described in Requirement 19.

---

### Requirement 19: Topic by Voice (Ghost Tutor)

**User Story:** As a user who cannot type well, I want to say the topic I want to learn about and confirm it by voice, so that I can start a lesson without typing.

#### Acceptance Criteria

1. THE Ghost_Tutor SHALL display a microphone button next to the topic input that uses the skeleton Speech_Input in the Chosen_Language.
2. WHEN Speech_Input produces Heard_Text on the topic screen, THE Ghost_Tutor SHALL place the cleaned Heard_Text in the topic input, limited to 100 characters.
3. WHEN the topic input has been filled by voice, THE Ghost_Tutor SHALL ask by voice and on screen "Shall I teach you about <topic>? Say yes, or press Start." in the Chosen_Language and listen once for a Voice_Command.
4. WHEN the user says "yes" or presses Start, THE Ghost_Tutor SHALL begin the lesson using the same validation and request as Requirement 11.
5. IF the user says anything else, or says nothing, THEN THE Ghost_Tutor SHALL leave the topic in the input box so the user can edit it or press Start.
6. IF the browser does not support SpeechRecognition, THEN THE Ghost_Tutor SHALL hide the microphone button next to the topic input.

---

### Requirement 20: Field Help (Spirit Clerk)

**User Story:** As a user who does not know what a form term means, I want to hear a simple explanation of each question, so that I can answer correctly.

#### Acceptance Criteria

1. THE AI_Backend SHALL return, for each Form_Field from `/api/extract-fields`, an extra `help` string containing one short, simple sentence in the Chosen_Language that explains what the field means with a small example (for example what "IFSC code" or "DOB" means), using the same route and the same single Gemini call.
2. IF the Google Gemini API returns a Form_Field with a missing or blank `help`, THEN THE AI_Backend SHALL return `help` as an empty string for that field and SHALL NOT fail the request.
3. THE Spirit_Clerk SHALL display a "(?)" help button next to each question, with a translated accessible name and a size of at least 44x44 pixels.
4. WHEN the user activates the help button, THE Spirit_Clerk SHALL display the Field_Help text and speak it using Speech_Output in the Chosen_Language.
5. WHILE the Field_Help is being spoken, THE Spirit_Clerk SHALL pause listening for the answer and SHALL resume listening after the Field_Help has finished.
6. IF a Form_Field has no Field_Help, THEN THE Spirit_Clerk SHALL hide the help button for that field.
7. WHEN the user changes the Chosen_Language, THE Spirit_Clerk SHALL translate the Field_Help with the translate request and cache it per language, in the same way as the questions.
8. IF translating the Field_Help fails, THEN THE Spirit_Clerk SHALL display the original Field_Help with the audio-unavailable note and SHALL NOT speak it with a mismatched voice.

---

### Requirement 21: How It Works

**User Story:** As a first-time user who cannot read much, I want to see three simple steps at the top of each app, so that I know what to do before I start.

#### Acceptance Criteria

1. THE Spirit_Clerk SHALL display at the top of its first screen three short numbered steps: "1. Upload a photo or PDF of your form.", "2. Answer each question by voice or by typing.", and "3. Check your answers and download the PDF."
2. THE Ghost_Tutor SHALL display at the top of its first screen three short numbered steps: "1. Say or pick a topic.", "2. The ghost teaches you in 4 short parts.", and "3. Answer one question after each part."
3. THE System SHALL store the text of all six steps in Locale_Files so that they are fully translated in all 20 languages and update immediately when the Chosen_Language changes.
4. WHEN the screen width is between 320 px and 767 px, THE System SHALL stack the three steps vertically; WHEN the screen is wider, THE System SHALL show the three steps side by side.

---

### Requirement 22: Privacy

**User Story:** As a user who uploads a personal form, I want to know what happens to my data and be sure it is not stored, so that I can decide whether to use the app.

#### Acceptance Criteria

1. THE Spirit_Clerk SHALL display on its upload screen, translated into the Chosen_Language, the note: "Your form is read by Google Gemini AI to find the questions. This app does not save your form or your answers. Do not upload documents you do not want to share."
2. THE AI_Backend SHALL NOT write uploaded files, answers, or translated text to disk, a database, or logs.
3. THE AI_Backend SHALL keep uploaded files only in memory for the duration of the request.
4. IF an error is logged by the AI_Backend, THEN THE AI_Backend SHALL log only error codes or messages and never request bodies.

---

### Requirement 23: Phantom Lens · Form Translator

**User Story:** As a user who cannot read a form written in another language, I want to upload a photo or PDF of the form and get the same form back with its printed text replaced by my language, so that I can read it and keep a copy, like Google Lens.

#### Acceptance Criteria

1. THE System SHALL provide a third app, Form_Translator, at `/apps/form-translator`, built on the shared `/skeleton` modules. It SHALL need no voice input.
2. THE AI_Backend SHALL expose `POST /api/translate-layout` that accepts one page image (`imageBase64`, `mimeType`, `lang`), makes ONE Gemini call, and returns `{ blocks: [{ text, translation, box_2d }] }`: every printed text block on the page, its translation into the Chosen_Language, and its box as `[ymin, xmin, ymax, xmax]` on a 0 to 1000 scale.
3. THE AI_Backend SHALL return HTTP 400 for a missing image, an unsupported image type, or a missing language, and SHALL use the same 504 / 429 / 502 error mapping as the other routes.
4. THE AI_Backend SHALL validate Gemini's JSON: a block with a blank translation, a `box_2d` that is not four finite numbers, or a box with no area SHALL be dropped; box values outside 0 to 1000 SHALL be clamped into that range. IF the reply has no `blocks` array, THEN THE AI_Backend SHALL return HTTP 502.
5. WHEN the user uploads a PDF, THE Form_Translator SHALL render each page to an image in the browser (at most 5 pages; extra pages are ignored with a translated note) and SHALL call `/api/translate-layout` once per page, one page after another, showing "page n of total" progress.
6. IF one page cannot be translated, THEN THE Form_Translator SHALL keep that page as it was, say so, and continue with the other pages.
7. THE System SHALL provide the shared module `skeleton/form-overlay.js` (reusable by Spirit Clerk) that draws a page image on a canvas, covers each block with the background colour sampled in a ring around it, and writes the translated text inside the box, wrapped and auto-sized to fit, using browser fonts so that all 20 languages (including Tamil) render correctly.
8. THE pure logic of the overlay (box conversion, text wrapping and font fitting, colour sampling, readable text colour) SHALL live in `skeleton/form-overlay-utils.js` without any DOM access and SHALL have unit tests.
9. THE Form_Translator preview SHALL offer "A-" and "A+" buttons that change the text size of ALL blocks, and an "Auto" button that returns to auto-fit. The preview SHALL redraw at once, with no new request.
10. THE Form_Translator SHALL offer "Download PDF": one PDF page per image, with each page's size matching its image's shape, and the text drawn as part of the image so non-Latin text shows correctly.
11. THE Form_Translator SHALL offer "Read aloud", which speaks the translations in reading order (top to bottom, left to right, page by page) in the translated language, and a "Stop" button. IF the browser has no voice for the language, THEN it SHALL show a translated note instead.
12. THE Home_Screen SHALL show a third app card with the big translated name "Translate a form" (Tamil: "படிவத்தை மொழிமாற்று") and the small English name "Phantom Lens · Form Translator", and THE Navigation_Header menu SHALL list the app.
13. THE Form_Translator upload screen SHALL show the same kind of privacy note as Spirit Clerk (adapted to this app: the form is read and translated by Google Gemini AI and is not saved) and the same working spinner while it works. THE AI_Backend SHALL NOT store the image or the translation (see R22).
14. THE System SHALL add every new UI string to `en.json` and the 19 other Locale_Files with the same keys.
15. THE Form_Translator SHALL make each cover adaptive: after the first cover (the box plus 20% of its height, at least 3 px) it SHALL scan a thin ring outside each side for pixels like the original letters and grow that side step by step until none are left, by at most 1.5 x the box height sideways and 0.5 x up and down, and SHALL NOT grow across a long straight line (a form border), out of the image, or into another block's box.
16. WHEN the translation is wider than its box, THE Form_Translator SHALL let the text use the plain background found next to the box by the same pixel scan (no ink, no border), up to 2 x the box width. THE AI_Backend SHALL ask Gemini, in the same call, for a `short` version of each translation, and THE Form_Translator SHALL use it when the full translation would be drawn smaller than 60% of the estimated size of the original text.
17. WHEN the Chosen_Language is not written in Latin letters, THE AI_Backend prompt SHALL require every block to be written fully in that language and script, including names, brand names and English words (for example CoinMarketCap, ghilli and John in Tamil letters). ONLY e-mail addresses, web links, numbers, dates and ID codes (such as PAN or IFSC codes) SHALL stay unchanged. A block whose translation equals the original SHALL be left untouched only for a Latin-script language, or when the text is one of those exceptions. THE AI_Backend SHALL log, as a count only, how many translations still contain Latin letters outside the exceptions.

---

### Requirement 24: Fill the Original Form (Spirit Clerk)

**User Story:** As a user who has answered the questions of a form in my own language, I want my answers written in English on the original form itself, so that I can print or send the real form and not only a list of answers.

#### Acceptance Criteria

1. THE AI_Backend `POST /api/extract-fields` SHALL accept, besides the old `fileBase64` + `mimeType` body, a body `{ images: [{ mimeType, data }], lang }` with 1 to 5 page images (JPEG, PNG or WEBP). It SHALL still make ONE Gemini call for all pages together.
2. In that same call THE AI_Backend SHALL ask for each field also `answerBox` (`[ymin, xmin, ymax, xmax]` on a 0 to 1000 scale: the empty space where the answer is written, that is the input box, the line, or the space after the label) and `page` (0-based number of the image the field is on). Each returned field SHALL have `answerBox` (an array of four whole numbers, or `null`) and `page` (a whole number).
3. THE AI_Backend SHALL read `answerBox` and `page` as tolerantly as `layout-parser.js` reads `box_2d`: other key names, a box nested one level deeper, a box written as an object, numbers written as text, and a 0 to 1 scale SHALL be repaired; values SHALL be clamped to 0 to 1000. A missing, malformed or too small box, a page that is not a whole number inside the images, or a missing page when there are several images SHALL give `answerBox: null` and SHALL NOT remove the field or fail the request.
4. WHEN the user uploads a PDF, THE Spirit_Clerk SHALL render its pages to images in the browser (at most 5; extra pages are ignored with a translated note) with the same shared code as the Form_Translator, and send those images, so that the boxes match the pictures. A photo SHALL be sent the same way as one page.
5. THE summary screen SHALL show a second button, "Fill the original form", next to "Download PDF".
6. WHEN the user presses it, THE Spirit_Clerk SHALL show a preview of the uploaded pages in which each confirmed answer (the same English text the summary PDF uses) is written inside its `answerBox`: left-aligned, vertically centred, in dark blue like pen ink, at the largest size that fits (words are never split; a long answer uses more lines when the box is high enough). Skipped fields SHALL stay empty. The preview SHALL NOT cover or change anything printed on the form.
7. THE preview SHALL offer "A-", "A+" and "Auto" buttons that change the size of ALL answers and redraw at once, with no new request, and a button to go back to the summary.
8. THE preview SHALL offer "Download PDF": one PDF page per page image, each with the shape of its image and the answers drawn as part of the picture. Answered fields without a usable box (or whose page is missing) SHALL be listed on an extra last page titled "Answers that could not be placed" (English, like the rest of the PDF), so no answer is lost. The preview SHALL show the same list in the user's language. IF no field has a usable box, THEN a translated note SHALL say so and the list SHALL still be shown.
9. THE pure logic (reading the box and page, sorting answers onto pages, fitting an answer into its box) SHALL live in modules without DOM access and SHALL have unit tests. The drawing SHALL live in the shared `skeleton/form-overlay.js`.
10. THE System SHALL add every new UI string to `en.json` and the 19 other Locale_Files with the same keys.

---

### Requirement 25: Reliable Voice Answers (Spirit Clerk)

**User Story:** As a user who says a PAN code, a phone number or an e-mail address aloud, I want the app to wait for me, clean what it heard and let me fix a single wrong letter, so that voice answers are not stressful.

#### Acceptance Criteria

1. WHEN Spirit_Clerk listens for an answer, THE Skeleton `speech-input.js` SHALL listen continuously through short pauses and finish the answer only after 2.5 seconds of silence (4 seconds when the field kind is `number`, `code` or `email`). IF the browser ends the recognition early, THEN it SHALL be restarted and the parts joined with one space. The text heard so far SHALL be shown on screen while the user speaks, and a "Done" button SHALL finish the answer at once. Listening for one short command ("correct" / "wrong") SHALL stay a single phrase.
2. THE AI_Backend `POST /api/extract-fields` SHALL accept the field kind `code` (identification codes made of letters and digits, such as PAN, IFSC, GSTIN, passport or vehicle numbers) besides `name`, `email`, `number`, `date` and `text`.
3. THE Spirit_Clerk SHALL clean every voice or typed answer by the kind of its field: `number` gives digits only (digits of other scripts and English digit words included); `code` gives UPPERCASE letters and digits with no spaces, dots or dashes; `email` gives lower case with no spaces, the spoken "at" and "dot" (English and the words `voice.atWords` and `voice.dotWords` of the Locale_File) turned into "@" and "."; `name` and `text` lose a trailing full stop. A code or e-mail address heard in letters of another script SHALL be written in Latin letters (transliterated) first.
4. THE confirmation question SHALL ask the user to say "correct" or "wrong" in the Chosen_Language (Tamil: "சரி என்றால் 'சரி', தவறு என்றால் 'தவறு' என்று சொல்லுங்கள்"). THE System SHALL build the command words from the Locale_File keys `voice.correctWords` and `voice.wrongWords` (Tamil correct: `சரி|ஆம்|ஆமா|ஆமாம்|ஓகே|ok`; wrong: `தவறு|மீண்டும்|இல்லை`), and the confirm screen SHALL show two big buttons "✓ Correct" and "✗ Wrong". The keys `voice.yesWords` and `voice.redoWords` stay for Ghost_Tutor.
5. WHEN nothing usable was heard, THE Spirit_Clerk SHALL say "I did not understand" and listen again only ONCE. After that it SHALL stop listening and put the text heard so far into the editable text box with a translated hint, so the user can fix it by typing.
6. BEFORE writing the answers on the original form (Requirement 24), THE Spirit_Clerk SHALL check each answer box for existing ink (text or marks, not the box borders, dividers or the line to write on). IF a box already holds text, THEN nothing SHALL be drawn there and the answer SHALL be listed on the extra last page "Answers that could not be placed".
7. THE System SHALL add every new UI string to `en.json` and the 19 other Locale_Files with the same keys.

---

### Requirement 26: Answer Flow Redesign (Spirit Clerk)

**User Story:** As a user who answers a form by voice, I want to talk like I would in a voice message, see my answer in a box I can edit, and be shown the exact format of codes and dates, so that a wrong letter or a short pause never makes me start again.

(This replaces criteria 1 and 5 of Requirement 25: there is no 2.5 s / 4 s silence rule and no automatic "say it again" loop any more. The rest of Requirement 25 stays.)

#### Acceptance Criteria

1. THE "Speak" button SHALL start continuous listening that does NOT stop when the user pauses. Listening SHALL end only when the user presses a big "Done" button, says a done word from the Locale_File key `voice.doneWords` (Tamil: `முடிந்தது|முடிஞ்சது|போதும்|done`), or after 15 seconds of total silence (the safety stop). IF the browser ends the recognition, THEN it SHALL be restarted silently (trying again if the browser refuses) and the text heard so far SHALL be kept. The live text SHALL be shown while the user speaks, and a done word SHALL NOT be part of the answer.
2. WHEN listening ends, THE Spirit_Clerk SHALL show the answer in a real, always editable control (a text box, character boxes, an e-mail box or date pickers) with two big buttons "✓ Correct" and "✗ Wrong". Nothing SHALL move on automatically: "Correct" (button, or a spoken correct word heard once after a valid answer) goes to the next field, and "Wrong" clears the answer and listens again. There SHALL be no automatic "please say it again" loop. A "Skip this question" button SHALL always be available. "Correct" SHALL be enabled only when the answer is valid for its kind.
3. THE AI_Backend `POST /api/extract-fields` SHALL return for each field a `kind` that is one of `name`, `text`, `address`, `date`, `number`, `phone`, `email`, `code`, `choice`, `checkbox` or `signature`, and a `pattern` (a string, empty when unknown) for `code`, `number` and `phone` fields. A pattern uses `A` for a letter, `9` for a digit, `X` for either, and a digit 0 to 8 for that fixed digit. These patterns SHALL be known without Gemini from the label: PAN `AAAAA9999A`, IFSC `AAAA0XXXXXX`, Aadhaar `999999999999`, Indian mobile `9999999999`, PIN code `999999`; dates are `DD/MM/YYYY`. A valid pattern from Gemini SHALL be kept for other codes and an invalid one dropped.
4. A `code`, `number` or `phone` field with a pattern SHALL be shown as one box per character (letter boxes and digit boxes in different colours; a letter in a digit box or a digit in a letter box turns red) and asked in groups that follow the pattern (for PAN: 5 letters, 4 digits, 1 letter; long digit runs are cut into equal parts of at most 6), with the group named on screen and aloud ("First: letters (5)", "Now: digits (4)", "Last: letters (1)"). The groups SHALL be heard with English (en-IN) recognition. The parser SHALL accept spelled letters, number words and "double 5", NATO words and "B for Bombay" style words. Tapping a box SHALL offer "say this character again" and a big on-screen keypad (A-Z, 0-9). "Correct" SHALL be enabled only when the pattern is complete and valid.
5. An `email` field SHALL ask only the part before the @ (English recognition, spelled or spoken, number words become digits), then offer big buttons `@gmail.com`, `@yahoo.com`, `@outlook.com` and Other, and SHALL be validated.
6. A `date` field spoken in any language SHALL become `DD/MM/YYYY`, and day, month and year pickers SHALL let the user fix it. `phone` and `number` answers SHALL be digits only with the validated length.
7. WHEN an answer is spoken in another language than English, or is a date that is not clear in English, THE Spirit_Clerk SHALL send it with its kind, label and pattern to `POST /api/translate`, which SHALL return in the SAME Gemini call both the English `translation` and `value`, the form-ready English answer (date as DD/MM/YYYY, digits only, a valid e-mail address, an uppercase code matching the pattern, an English name in Title Case, the full English address). `answer-cleaning.js` SHALL clean the value offline and stay the fallback when Gemini does not answer.
8. A `signature` field SHALL never be asked by voice and never be filled with text: it is skipped with a translated note, is not counted as a skipped question, and does not count in "Question n of total".
9. EVERY new UI string SHALL be added to `en.json` and the 19 other Locale_Files with the same keys.

---

### Requirement 27: Signature, Options, Comb Boxes, Review and Picture PDFs (Spirit Clerk, part 2)

**User Story:** As a user who fills a form, I want to sign with my finger, pick options with big buttons, see my answers placed neatly in the boxes of the real form, check everything once, and download a PDF in my own script, so that the result is ready to print.

(This replaces criterion 8 of Requirement 26: a signature field is now shown with a pad.)

#### Acceptance Criteria

1. FOR a `signature` field THE Spirit_Clerk SHALL show "Sign here" with a white pad where the user DRAWS the signature with a finger or the mouse (pointer events, smooth lines, Clear and Use buttons; a dot or a tiny mark is not accepted), or the button "I will sign by hand after printing", which leaves the field empty on purpose. A signature SHALL never be typed, generated or made up, and a signature field SHALL never be asked by voice. The signature is kept as a transparent picture cut to its drawn part.
2. IN "Fill the original form" THE drawn signature SHALL be placed inside the answerBox of the signature field, scaled to fit with its shape kept and centred; without a usable box it SHALL be listed with its picture on the extra last page.
3. FOR a `choice` field THE AI_Backend SHALL return in the same `extract-fields` call `options`: a list of `{ label, box }` (the label as printed, the small box, circle or bracket to tick, or null). THE Spirit_Clerk SHALL show the options as big buttons (Yes / No for a `checkbox` field) that can also be chosen by saying the option: the words are matched on the device, a tick box also understands the "correct" / "wrong" words, and otherwise ONE call to `/api/translate` (with the option labels) picks the option in any language.
4. IN "Fill the original form" a chosen option SHALL get a tick mark in ITS box, and a tick box answered "Yes" SHALL get a tick in its box, instead of text; "No" draws nothing. An option without a box falls back to text in the answerBox. Tick boxes are not checked for existing ink (they hold a printed circle or square).
5. WHEN an answerBox is divided into character cells (vertical dividers about the same distance apart, 4 or more cells), THE Spirit_Clerk SHALL write ONE character per cell, centred, for a code, number, phone number or date (a date in a comb of 10 cells leaves the printed separator cells empty); a short answer is written from the left. An answer that does not fit the cells is written as one text line.
6. AFTER the last question THE Spirit_Clerk SHALL show a review screen with every field and its answer (a signature as a small picture), each with an "Edit" button that returns to that one question and then back to the review, and a big "All correct" button that continues to the summary. Back from an edit returns to the review without losing answers.
7. THE summary PDF and the extra page "Answers that could not be placed" SHALL draw their text on canvases and add them to the PDF as pictures (like the Form Translator PDF), so labels and answers in every script, including right-to-left text, show correctly. Drawn signatures appear as pictures in these PDFs.
8. IF speech recognition is not available in the browser, or the microphone is blocked or does not work, THEN THE Spirit_Clerk SHALL show ONE clear translated message (`spiritClerk.voiceOff`), hide the voice controls and continue with typing and the buttons; no screen is ever left without a way forward.
9. THE System SHALL add every new UI string to `en.json` and the 19 other Locale_Files with the same keys.


### Requirement 28: Voice Fixes from the Tamil Test (Spirit Clerk)

**User Story:** As a Tamil speaker, I want my spoken numbers, letters and options understood in my own language, so that I can fill a form by voice.

#### Acceptance Criteria

1. THE speech input SHALL remove sentence punctuation (. , ? ! । ۔ 。 ، and similar) from every interim and final result, join parts with a single space, and keep only "@" and the "." made by the app's own at/dot conversion in emails. "13. 05. 1987" SHALL become 13/05/1987.
2. THE app SHALL recognise spoken digits in the chosen language (including colloquial words, "double" words and native-script digits) for all 20 languages, and always accept English digit words. This SHALL apply to phone, number, date, PIN, Aadhaar, digit parts of PAN and IFSC, and the email name part.
3. THE app SHALL accept letter names in the chosen language (tables for ta, hi, te, kn, ml, bn, ur; English names for the rest) as well as English letter names, trying the chosen language first.
4. Phone, PIN and Aadhaar numbers SHALL be asked as one whole number. Only codes mixing letters and digits (PAN, IFSC) SHALL be split into chunks.
5. Choice and checkbox buttons SHALL show each option translated into the chosen language. The form and the PDF SHALL keep the original option. Spoken words SHALL match either form, including colloquial words.

### Requirement 29: Fill Original Fixes and Keypad-First Codes (Spirit Clerk)

**User Story:** As a user filling the original form, I want answers written neatly above the lines, empty dashed lines treated as empty, and codes typed on a keypad, so that the filled form is readable and correct.

#### Acceptance Criteria

1. WHEN the answer area has a line to write on (solid, dashed or dotted), THE app SHALL place the text's baseline a few pixels above the line so the letters (including descenders) never touch it. Inside a closed box THE text SHALL stay vertically centred.
2. THE "already has text" check SHALL ignore horizontal lines made of repeated short marks (dashes, dots, underscores) as well as solid lines.
3. FOR codes (PAN, IFSC and every other code kind) and bank account numbers, THE big on-screen keypad SHALL be the main input, open from the start with the character boxes. Voice SHALL be an optional small "Speak" button that hears the whole code in one turn. Codes SHALL NOT be asked chunk by chunk by voice.

### Requirement 30: Spirit Clerk Polish (answer size, signature, title case, keypad, edit, Speak button)

**User Story:** As a user, I want the filled form to look hand-written at the right size, my codes easy to type, and my answers kept when I edit them.

#### Acceptance Criteria

1. ON the original form, THE answer size SHALL come from the printed label on the same row (about 85% of the label's size, never below 70%; a longer answer wraps instead), still above the line and inside the area. Without a label the earlier fitting is used.
2. THE drawn signature SHALL fill most of the area above the line (height up to 2x the label height, shape kept), stay a few pixels above the line, and be drawn in dark ink with strokes of at least 2.5 px.
3. Name answers, typed or spoken, SHALL be kept in Title Case ("ravi kumar" -> "Ravi Kumar") in the box, the review, the summary and both PDFs.
4. ON the code keypad, a key equal to a fixed character at the cursor (the "0" of IFSC) SHALL step over it; after a box is replaced the cursor SHALL move to the next box; a big delete key (⌫) SHALL clear the current box (or, when it is empty, go back one box and clear that). Spoken codes SHALL follow the same fixed-character rule.
5. Edit from the review SHALL reopen the question with the earlier answer filled in (text, boxes, date, option, signature).
6. THE Speak button SHALL be a large rounded rectangle (about 14 px radius), full width, about 64 px tall, like Done.

### Requirement 31: Every Answer in English (Spirit Clerk)

**User Story:** As a user who types in my own language, I want my answers written on the form in English, just like my spoken answers.

#### Acceptance Criteria

1. WHEN Correct is pressed and the answer (typed or spoken, any language) contains letters that are not English, THE app SHALL convert it with the same conversion as spoken answers (names transliterated in Title Case, addresses and text translated) and show the English value under the heard text; a second Correct keeps the English value.
2. ONLY the English value SHALL be used in the review, the summary, the summary PDF and the filled original form.
3. IF the conversion fails or the reply is still not English, THE app SHALL keep the user on the question with a clear message and SHALL NOT keep the non-English text.
4. THE label size used to size answers on the original form SHALL be the label's ink height / 0.7.

### Requirement 32: Shared Celebrations, Coins and Stickers (skeleton)

**User Story:** As a player, I want happy, colourful rewards when I get something right, so that learning feels like a game.

#### Acceptance Criteria

1. THE skeleton SHALL provide `skeleton/celebrate.js` (plain canvas, CSS and Web Audio; no libraries, no audio files; works on phones) with:
   - `correct()`: confetti and small firecracker bursts from the bottom, a short happy sound, and coins flying into the coin bag in the header.
   - `levelUp()`: flower petals and coloured paper falling from the top for about 4 seconds, with a bigger sound.
   - `giftBox()`: a 3D-looking gift box shakes, the lid flies off and a sticker pops out. The sticker is saved in the sticker book.
2. THERE SHALL be at least 12 stickers drawn as inline SVG (ghost, pumpkin, owl, moon, bat, star, cat, candy and more), each with a name in all 20 languages.
3. Coins and stickers SHALL be shared by all apps and saved in localStorage (every access in try/catch; broken or missing data starts from zero).
4. THE nav header SHALL show a coin counter and a mute button for the sounds (the choice is saved). THE nav menu SHALL have a "Sticker book" page that shows every sticker, found ones in colour with how many times, missing ones as a silhouette.
5. WHEN prefers-reduced-motion is set, THE celebrations SHALL show a simple glow instead of moving pieces.
6. A celebration SHALL never block the page (no focus trap, pointer events pass through) and SHALL remove itself when done. A short polite announcement tells screen-reader users what happened.

### Requirement 33: Ghost Tutor Celebrations

1. WHEN a quiz answer is judged correct, THE Ghost Tutor SHALL call `correct()`.
2. WHEN a round of 4 parts ends with 3 or more correct answers in that round, THE Ghost Tutor SHALL call `levelUp()` and then `giftBox()`.
3. Which parts were answered correctly SHALL be kept in the saved progress, so a resumed round is counted right.

### Requirement 34: Ghost Echo, a Voice Memory Game (new app)

**User Story:** As a player, I want to remember pictures shown by the ghost and say them back in my language, so that I train my memory and vocabulary.

#### Acceptance Criteria

1. THE new app SHALL live in `apps/ghost-echo`, with the big translated name "Memory game" (Tamil "நினைவு விளையாட்டு") and the small English name "Ghost Echo · Voice Memory Game", a Home card and a nav entry.
2. THE ghost SHALL show and speak a sequence of picture words in the chosen language: 2 words at level 1, one more each level. The words come from a fixed list of 30 simple nouns with emoji pictures, translated (with spoken variants) in all 20 locale files.
3. THE player SHALL repeat the words in order by voice, or by tapping the picture buttons (always available, also without a microphone).
4. Voice matching SHALL be forgiving: punctuation and case are ignored, each word's listed variants are accepted, small spelling differences are accepted, and a word with an ending stuck to it (Tamil "பூனையும்") still counts.
5. A correct answer SHALL call `correct()`; every 3 levels SHALL also call `levelUp()` and `giftBox()`. A wrong answer SHALL show the right order gently and offer "Try again".
6. THE best level SHALL be saved in localStorage and shown.
7. Ghost Echo SHALL make no Gemini calls.

### Requirement 35: Bigger Gift Box and More Flowers

1. THE gift box SHALL be shown centred on a dim overlay, about 3 times bigger than before (smaller only when the screen is too small), and SHALL stay until the user taps "Collect" (or presses Escape); it closes by itself after 8 seconds. Focus moves to "Collect" and returns afterwards.
2. `levelUp()` SHALL also drop flower shapes (five-petal flowers and daisies) besides petals and paper.

### Requirement 36: My Documents (new page)

**User Story:** As a user, I want every PDF the apps make kept on my phone, so that I can open, share or download it again later without the internet.

#### Acceptance Criteria

1. THE new page SHALL live in `apps/my-documents` (Tamil "என் ஆவணங்கள்"), with a Home card and a nav entry.
2. EVERY PDF the apps create (Spirit Clerk summary PDF, filled original form, Form Translator translated form) SHALL also be saved on the device in IndexedDB with its name, app and date. Saving is in try/catch: if it fails, the download still works.
3. THE page SHALL list the documents newest first, each with Open, Download, Share (Web Share API with the file; hidden when the browser cannot share files) and Delete (with an in-page confirm, never window.confirm).
4. THE page SHALL show the total size and the note "Saved only on this device. Nothing is uploaded." There is no login and no server storage.

### Requirement 37: Voice Notes (new page)

1. THE new page SHALL live in `apps/voice-notes` (Tamil "குரல் குறிப்பேடு"), with a Home card and a nav entry.
2. THE user SHALL add a note by Speak / Done (skeleton speech input in the chosen language) or by typing. Notes are saved in localStorage (try/catch) with their date.
3. EACH note SHALL have Read aloud (in the chosen language), Edit and Delete (in-page confirm). Big buttons, newest first, and a search box that filters the notes.
4. No network calls.

### Requirement 38: Remembered Language

1. THE chosen language SHALL be saved in localStorage (try/catch; sessionStorage as a fallback), so a new tab or another app opens in it.

### Requirement 39: Picture Book (new app)

1. THE new app SHALL live in `apps/picture-book` (Tamil "பேசும் படப் புத்தகம்"), with a Home card and a nav entry.
2. Pages of big emoji pictures: animals, fruits, colours, numbers, body parts and more. The shared picture word list SHALL have 60 words (the 30 Ghost Echo words and 30 more), with spoken variants in all 20 locale files.
3. THE ghost says the word; the child repeats it (forgiving match, the same one as Ghost Echo, moved to the skeleton) or taps "I said it". A correct word calls `correct()`; every 10 words calls `levelUp()` and `giftBox()`.
4. "Learn another language": the word is also shown and spoken in a second chosen language.

### Requirement 40: Pumpkin Math (new app)

1. THE new app SHALL live in `apps/pumpkin-math` (Tamil "பூசணிக் கணக்கு"), with a Home card and a nav entry.
2. Counting, addition and subtraction with pumpkin pictures, 5 levels of difficulty (counting to 5, counting to 10, adding to 10, taking away within 10, adding and taking away to 20).
3. THE answer SHALL be given by number buttons 0 to 20 (always) or by voice: digits, the digit words of Spirit Clerk (moved to the skeleton) and the number words 0 to 20 of every language.
4. Correct calls `correct()`; 5 correct in a row calls `levelUp()` and `giftBox()` and moves to the next level. A wrong answer gently shows the pumpkins being counted.

### Requirement 41: Story Time (new app)

1. THE new app SHALL live in `apps/story-time` (Tamil "கதை நேரம்"), with a Home card and a nav entry.
2. Six short, kind stories with a moral, 8 short paragraphs each, written into the locale files in all 20 languages.
3. Read aloud paragraph by paragraph with the paragraph highlighted; big text with A- / A+; Pause / Resume; Next / Previous by buttons or by voice ("next", "back", "stop" in the chosen language); the place where the reader stopped is remembered. Finishing a story calls `giftBox()`.

### Requirement 42: Home and README

1. `home.welcomeText` (all 20 languages) and the README SHALL list all apps.

### Requirement 43: Calm Ghost (new app)
1. THE new app SHALL live in `apps/calm-time` (big name Tamil "அமைதி நேரம்", small "Calm Ghost · Meditation and Routine"), with a Home card and a nav entry. No Gemini calls; all text in the 20 locale files.
2. Meditation: 5 / 10 / 20 / 30 minutes; a big circular countdown; a soft Web Audio bell at the start and the end and an optional interval bell (every 1 or 5 minutes); optional spoken guidance from fixed locale phrases with a breathing circle that grows (4 s) and shrinks (6 s); Pause / Resume / Stop; the screen is kept awake when the Wake Lock API exists. Bells follow the shared sound on / off setting.
3. THE timer SHALL be computed from timestamps (never by counting ticks), so it stays correct while the tab is hidden; marks passed while hidden play at most one bell and only the latest words.
4. Activity timer: walking, running, exercise, reading or a custom name; 15 / 30 / 45 / 60 / custom minutes (1–240); spoken encouragement at halfway, with 5 minutes left (skipped when it would come within a minute of halfway) and at the end.
5. Daily routine: items with activity, time, minutes and days of the week; tick done; today's list; a 7-day history; a streak of days with everything done (days with nothing planned are skipped). Saved in localStorage. A removed item stays in the history of earlier days.
6. Rewards: a finished session or a ticked item calls `correct()`; the tick that completes the whole day calls `levelUp()` and `giftBox()`.
7. Reminders: "Add reminder" downloads an `.ics` file (daily RRULE, or weekly BYDAY for chosen days, local floating time, an alarm at the time, lines folded at 75 bytes). While the page is open, a due item shows an in-page reminder and, if the user allowed it, a browser Notification. The page explains that phone reminders work through the calendar.
8. `home.welcomeText` (all 20 languages) and the README SHALL mention the app.

### Requirement 44: Voice Translator (new app)
1. THE new app SHALL live in `apps/voice-translator` (big name Tamil "பேசி மொழிபெயர்", small "Phantom Talk · Voice Translator"), with a Home card, a nav entry and its own 3D icon (two speech bubbles with A/அ).
2. From: the chosen language (default the page language); To: any of the 20 (the last one is remembered). Speak / Done or type, then ONE `/api/translate` call with `style: "everyday"` (natural, everyday spoken translation, not word by word), using the shared server cache. Same language: no call.
3. The translation is shown large and read aloud in the target voice; Copy uses the Clipboard API with a fallback and shows "Copied"; Share uses the Web Share API and is hidden when unsupported; a Swap button swaps the languages.
4. Conversation mode: "Me" and "Other person", each with a language picker and a big microphone in its own colour with the language name on it. The other person's words are recognised in their language, translated into mine, shown and read aloud in mine; my reply is recognised in mine, translated into theirs, shown and read aloud in theirs. Every chat bubble shows the original and the translation. A flip button rotates the other person's half by 180°. Typing is possible on both sides.
5. The last 30 translations are kept in localStorage with Copy and Delete.
6. The server SHALL accept only a valid language code in `sourceLang` / `targetLang` for this style (no extra instructions in the prompt) and refuse text over 2000 characters.

### Requirement 45: Installable app (PWA)
1. `/manifest.webmanifest` with name, colours and 192 / 512 px PNG icons (also maskable), drawn by `tools/make-icons.mjs` with plain Node (no packages). Every page links it.
2. A service worker at `/sw.js` caches the app shell and every app that needs no AI, so they work offline; pages are network-first, files cache-first; `/api` responses are NEVER cached. A page that was never opened shows a translated offline page.
3. Apps that need the internet (Spirit Clerk, Ghost Tutor, Form Translator, Voice Translator) show a clear "needs internet" message while offline.
4. An "Install app" button appears in the menu while the browser offers installation.
5. The server serves `/sw.js` (no-cache) and `/manifest.webmanifest` with `sendFile` only; there is still no static folder at the repository root.

### Requirement 46: Large text mode
1. An "Aa" toggle in the header SHALL scale text and buttons by about 125 % in every app, be remembered in localStorage, be applied before the page is shown, work in RTL, and never cause horizontal scrolling on a 320 px phone.

### Requirement 47: Home categories and demo
1. "Who is it for?" SHALL include children. Filter chips All / For children / For adults / For everyone SHALL show the matching Home cards (children: Memory game, Picture book, Pumpkin math, Story time, Sticker book; adults: Fill a form, Translate a form, Voice Translator, My documents, Voice notes; everyone: Learn by speaking, Calm Ghost); the chosen chip is remembered.
2. A "Watch the demo video" link SHALL open DEMO_VIDEO_URL (https only, set to https://youtu.be/Imi-Y5hDKcc) in a new tab and stay hidden while it is empty.

### Requirement 48: "How to use" guides
1. Every app page SHALL have a "▶ How to use" button that opens a 3 or 4 step walkthrough: the real button of each step is highlighted, an animated finger taps it, and the step is shown and read aloud in the chosen language, with Skip / Next / Done. It opens by itself once on the first visit to each app. Reduced motion stops the animation.

### Requirement 49: Ready for submission
1. The server listens on process.env.PORT and answers GET /healthz; package.json names the Node version; render.yaml describes a free Render web service with GEMINI_API_KEY and GEMINI_MODELS set only in the dashboard.
2. .gitignore covers .env, node_modules and temp files; LICENSE is MIT by Sankar D; the README is the final version for judges.

### Requirement 50: Voice Translator: silent by default, automatic translation, Message helper
1. Nothing SHALL be read aloud automatically. In Conversation mode the other person's words appear in my language as text; my reply appears in their language with a "🔊 Say it to them" button that speaks only when tapped. Every chat bubble has Copy. A setting "Speak translations automatically" (off by default, remembered) brings back automatic reading.
2. Translate mode SHALL translate by itself after Done, when the target language changes, and 1 s after typing stops; the Translate button stays. The same request is never sent twice, and the server cache is reused.
3. A third tab "Message helper" (Tamil "செய்தி உதவி"): a "Paste the message you received" box with a Paste button (Clipboard API; typing works too). ONE call with style "detect" returns the language code and the meaning in my language; when the language is not found, the user picks it.
4. "✨ Write a reply for me": ONE call with style "reply" returns 3 short, polite, natural replies IN the sender's language, each with its meaning in my language. An optional hint ("Tell it what to say"), typed or spoken in my language, becomes the meaning of the replies.
5. The chosen reply is shown large with "👁 See it in <my language>" (shows or hides the meaning, no extra call), "🔄 Another reply" (the next reply already written, then new ones), Copy with a "Copied" toast, and Share (hidden when unsupported). Nothing is read aloud in this tab.

### Requirement 51: No sideways scroll from hidden helpers; no Latin letters glued into words
1. Every visually hidden helper (.visually-hidden, .pvk-sr-only, .file-input-hidden, the header's language label) SHALL be at most 1 x 1 px whatever element it is on, stay focusable (a hidden file input opens through its label) and never be display:none.
2. For every style of /api/translate whose answer is in a non-Latin script, Latin letters glued into or onto a word of that script (for example "வரவேற்ப Leukிறேன்" instead of "வரவேற்கிறேன்") SHALL cause ONE retry with a stricter prompt; when it still happens, the better answer is kept. Separate brand names, e-mails, links and codes ("GiveawayProof", "GenLayer", "drand") are allowed.

### Requirement 52: Talk & Learn (new app)

1. THE new app SHALL live in `apps/talk-learn` (big name Tamil "பேசிக் கற்போம்", small "Talk & Learn · Speak a New Language"), with a Home card, a nav entry, its own 3D icon (a ghost with a speech bubble that holds a star) and the audience "everyone" (the "For everyone" chip, for adults and children). It reuses the skeleton (nav, i18n, speech input and output, text fallback, celebrations, theme, api-client) and needs the internet only to make a new lesson.
2. Setup: "I speak" is the current UI language (it follows the language dropdown). "I want to learn" is a dropdown of the 20 supported languages without the language the user speaks (the two can never be the same). Both are remembered in localStorage. When the UI language becomes the language being learned, another language is chosen.
3. Fourteen lessons in this fixed order, with the titles in the locale files in all 20 languages: 1 Greetings and meeting someone, 2 Asking name and where someone is from, 3 At a small shop, 4 Buying vegetables and fruit, 5 Asking for directions, 6 Auto or taxi ride, 7 Bus or train ticket, 8 At a restaurant, 9 At the doctor or pharmacy, 10 At work with a new colleague, 11 Simple phone call, 12 At the bank, 13 At a hotel, 14 Asking for help in an emergency. A completed lesson gets a tick; the ticks are saved in localStorage for each language being learned.
4. `POST /api/conversation { scenario, learnLang, speakLang }` uses the route factory pattern (`createConversationRouter(callGemini)`), the same error mapping as the other routes (400 `invalid_input`, 429 `busy`, 502 `gemini_error` or `bad_ai_response`, 504 `timeout`) and the shared `callGemini` with its timeout. `scenario` must be one of the 14 lesson ids; `learnLang` and `speakLang` must be two different languages of the 20 supported (a code such as `hi-IN` or `hi`). No other text reaches the prompt.
5. The reply is `{ lines, keyWords }`: 6 to 8 short everyday lines between person A (first) and person B, each `{ speaker, text, say, meaning }` (`text` in the language being learned, `say` = how it sounds, written in the script of the language the user speaks, `meaning` in the language the user speaks), and 4 to 5 `keyWords` `{ word, say, meaning }`. The prompt asks for a simple, polite, spoken style with short sentences and no rare words. An answer with fewer lines or key words, an empty text, or only one speaker is refused with 502 `bad_ai_response`. Latin letters glued into a word of a non-Latin script cause ONE stricter retry (Requirement 51).
6. Each lesson is cached in localStorage under a key made from scenario + learnLang + speakLang. Opening the same lesson again makes no API call. A damaged cache entry is ignored and fetched again; a full or blocked storage never stops the lesson.
7. Every lesson has three modes. **Listen** plays the whole conversation in the language being learned; A and B use two different voices when the device has them (the same voice with a different pitch when it has only one), each line shows text, say and meaning, and the line being spoken is highlighted. **Line by line** shows one line with Play, Slow (speech rate 0.7) and Next. **Practice** is a role-play: the user is person B; the app speaks A's line, the user says B's line with the microphone in the language being learned, and a typed answer is always possible (the shared text fallback).
8. `scoreSpeech(expected, heard)` is a pure function that returns 0 to 100: it ignores case, punctuation, accents of Latin letters and Arabic vowel marks, then compares words (single characters for Chinese and Japanese) and gives the share of expected words that were heard, reduced when extra words were heard. 80 or more is 3 stars, 50 or more is 2 stars, otherwise 1 star. After every try the expected line is shown again with a Play button. 3 stars call `correct()` (the existing celebration). The user can try again or go to the next line.
9. At the end of every lesson (after the last line of Line by line or Practice, or from the "Key words and quiz" button) the app shows the key words card and a 3-question quiz "pick the meaning", built from the key words with no extra API call (the right meaning and two other meanings of the same lesson, in a random order). When the quiz is finished the lesson is marked complete and saved.
10. When the device has no voice for the language being learned, the text stays visible, a message says that audio is not available, and no other language's voice is ever used. Voice input that is missing or fails leaves the typed answer.
11. Every string is in `en.json` and the 19 other locale files; the layout uses logical (start/end) properties, `dir="auto"` on the text lines and works from 320 px, in right-to-left languages and in large text mode. `home.welcomeText` (all 20 languages) and the README mention the app.

### Requirement 53: Talk & Learn 2.0, part A-1: levels, built-in lessons, prefetch, friendly loading

1. THE 14 lessons of Requirement 52 SHALL become **Level 1 Basics**. **Level 2 Daily life** (12 lessons) and **Level 3 Speak with confidence** (10 lessons) SHALL be added after them, 36 lessons in all, in this order. Level 2: at home, family and relatives, bargaining at a market, cooking, festivals, school and children, hospital visit, office meeting, salary and payments, booking a trip, post office, renting a house. Level 3: giving your opinion, what happened yesterday, plans for tomorrow, making a complaint, job interview, customer care call, asking a favour, apologising, giving directions to someone, small talk with neighbours.
2. THE lesson list SHALL show three headed sections, each with its own progress ("2 of 12 lessons completed"). No level is locked: every lesson is open; the order is only a recommendation. The server scenario list (`SCENARIO_IDS`, the situation texts), the locale titles and the level headings cover all 36 lessons.
3. **Built-in lessons**: static files `apps/talk-learn/lessons/<speak>-<learn>/<scenario>.json` (two-letter language codes, for example `ta-hi`) in the exact shape of the `/api/conversation` answer, plus `apps/talk-learn/lessons/index.json` listing the lessons of each pair. This release has all 36 lessons for Tamil to Hindi and Tamil to English, and the 14 Level 1 lessons for English to Hindi and English to Spanish. Every built-in file is checked with `cleanConversation` when it is loaded; a missing or damaged file is skipped.
4. A lesson is loaded in this order: built-in file, then the localStorage cache, then `/api/conversation` (the answer is then saved in the cache). A built-in or cached lesson makes no API call and shows no loading screen.
5. **Prefetch**: while a lesson is open, the next lesson in the order is generated quietly in the background when it is neither built-in nor cached. Only one background request runs at a time; a background request never repeats a lesson that failed or was cancelled; the first 429 (busy) answer, from the background or from the user's own request, stops prefetching for the rest of the browser session (remembered in sessionStorage, so a reload does not restart it). The user's own requests are still sent after a 429. If the user opens the lesson that is being prefetched, the same request is used (no second call).
6. **Loading**: while a lesson is being generated, a friendly ghost shows messages that change every few seconds (for example "Choosing simple everyday words…") and a Cancel button. Cancel returns to the lesson list at once and aborts the request; a cancelled lesson is NEVER saved, even when its answer arrives later. Leaving the page or opening another lesson cancels in the same way. The animation stops with reduced motion.
7. Every new string (level headings, 22 lesson titles, loading messages, Cancel, the note that all lessons are open) is in all 20 locale files. The built-in text is natural spoken language; `say` is written in the script of the language the user speaks (Tamil script for Tamil speakers) so it can be read aloud without learning a new script, and `meaning` is in the language the user speaks.

### Requirement 54: Talk & Learn 2.0, part A-2: Tamil to Kannada, Telugu and Malayalam

1. Built-in lessons SHALL exist for Tamil to Kannada (`ta-kn`), Tamil to Telugu (`ta-te`) and Tamil to Malayalam (`ta-ml`): all 36 lessons each, in the same folder layout and shape as Requirement 53, listed in `lessons/index.json`. A Tamil speaker opening any of them makes no API call.
2. `text` is natural, simple, polite spoken Kannada, Telugu or Malayalam (the same situations and line meanings as the other pairs); `meaning` is the same Tamil as in the Tamil to Hindi lesson; `say` is written only in Tamil letters so it can be read aloud without learning the other script.

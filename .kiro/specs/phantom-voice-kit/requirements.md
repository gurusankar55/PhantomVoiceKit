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
2. WHEN the user activates the menu button, THE Navigation_Header SHALL open a side drawer that slides in from the left and lists three links: "Home" (/), "Spirit Clerk" (/apps/spirit-clerk/index.html), and "Ghost Tutor" (/apps/ghost-tutor/index.html).
3. THE drawer SHALL highlight the link for the current page and mark it with ria-current="page".
4. THE menu button SHALL set ria-expanded to 	rue while the drawer is open and alse while it is closed, and SHALL have an ria-label that describes its action.
5. WHEN the user activates a drawer link, clicks outside the drawer, or presses the Escape key, THE Navigation_Header SHALL close the drawer.
6. WHEN the user activates the Back button AND the current app has a previous screen in its screen history, THE System SHALL return to that previous screen inside the app.
7. WHEN the user activates the Back button on the first screen of an app, THE System SHALL navigate to the home screen (/).
8. WHILE the home screen is displayed, THE Navigation_Header SHALL show the menu button and SHALL hide the Back button.
9. WHEN the user tries to leave the Spirit Clerk form-fill screen before all fields are processed (by the Back button or by a drawer link), THE System SHALL ask for confirmation with the text "Your answers will be lost. Go back?" and SHALL leave the screen only if the user confirms.
10. WHEN the user navigates away from a page or screen using the Navigation_Header, THE System SHALL stop any Speech_Output in progress.
11. THE Navigation_Header SHALL apply the Halloween theme defined in Requirement 6, SHALL make every control at least 44×44 px, and SHALL not cause horizontal overflow on viewport widths from 320 px to 767 px.

---

### Requirement 17: Localization

**User Story:** As a user who cannot read English, I want every button, label, and message in the app to appear in my chosen language, so that I can use the app without understanding English.

#### Acceptance Criteria

1. THE language dropdown SHALL list each of the 20 supported languages by its own name in its own script followed by the English name in parentheses, for example "தமிழ் (Tamil)", "हिन्दी (Hindi)", and "中文 (Chinese)".
2. THE System SHALL store every fixed UI string used on the home screen, the Navigation_Header, and Spirit Clerk (titles, buttons, labels, placeholders, tips, aria-labels, confirmation dialogs, error messages, and status messages) in Locale_Files, with `skeleton/locales/en.json` as the source of truth and one Locale_File for each of the other 19 languages.
3. THE skeleton SHALL provide an i18n module that exposes `t(key)`, loads `/skeleton/locales/<code>.json` on demand, caches each loaded file, and falls back to the English text for any key that is missing in the chosen language.
4. THE i18n module SHALL translate elements marked with `data-i18n` attributes (text, and attributes such as `aria-label` and `placeholder`) when `applyTranslations(root)` is called.
5. WHEN the user changes the Chosen_Language, THE System SHALL update all visible text, aria-labels, placeholders, and dialog messages to that language immediately, without reloading the page.
6. WHEN a page loads, THE System SHALL display the UI in the language stored in `sessionStorage.chosenLang`, or in English if none is stored.
7. THE System SHALL set the `lang` attribute of the `<html>` element to the Chosen_Language code, and SHALL set `dir="rtl"` for Arabic and Urdu and `dir="ltr"` for all other languages.
8. WHILE the layout direction is right-to-left, THE System SHALL mirror the layout using CSS logical properties, and THE Navigation_Header drawer SHALL slide in from the right.
9. THE text of the PDF summary SHALL always be in English, regardless of the Chosen_Language, and form labels, answers, and AI-generated text SHALL NOT be treated as UI strings.
10. EVERY Locale_File SHALL contain exactly the same keys as `en.json` and SHALL contain no empty values.
11. WHEN `skeleton/locales/en.json` is saved, THE System SHALL run a Kiro agent hook that adds new or changed keys to the other 19 Locale_Files with natural translations, removes keys that no longer exist in `en.json`, and never renames keys.

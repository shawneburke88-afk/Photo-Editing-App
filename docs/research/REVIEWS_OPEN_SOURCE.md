# Open-source photo editors: what reviewers and users say

Research input for LightBench UX design. The editors covered are darktable, RawTherapee, RapidRAW, digiKam and GIMP (photo-editing parts only). Compiled 2026-10-11.

The question behind it: the most common complaint about darktable is the learning curve. We want darktable's processing power with much better usability. What do users praise, what drives them away, and what should LightBench copy or avoid?

## How this was researched (read first)

- **Method.** Web search, plus GitHub issue search through the GitHub API.
- **Direct page fetching was not possible here.** WebFetch failed with DNS errors on every domain tried (petapixel.com, thephoblographer.com, digitalcameraworld.com, onecameraonelens.com). The outbound proxy refused direct HTTPS (403) to pixls.us, lwn.net, reddit.com, alternativeto.net, bugs.kde.org and hn.algolia.com.
- **What the evidence is.**
  - Most findings come from search-result titles, URLs and the excerpts the search tool returned. I did not read those pages in full.
  - Quotes are short phrases from the excerpts. Check the page before quoting it publicly.
  - **GitHub issues are the exception.** The issue search returned full issue bodies, so issues cited with a number (for example darktable #19084 or RapidRAW #26) were read in full.
  - Reaction counts on GitHub issues are given only where the API returned them.
- **Reddit.** Reddit could not be fetched or searched directly. A few r/DarkTable and r/FOSSPhotography threads appeared through mirror front-ends (redlib and similar), and they are cited by those mirror URLs. User voice comes mainly from discuss.pixls.us, Hacker News, Lemmy/PieFed, DPReview, Pentax Forums, the KDE forums and GitHub.
- **Hacker News.** Only titles and comment excerpts from search snippets were available, not full threads.
- **Dates.** A date is given where the excerpt or URL showed one. "Undated" means none was visible.
- **Bias flags.** Some sources have a stake or a strong slant, and they are flagged where used:
  - vendor blogs (Imagen AI, Aiarty);
  - one enthusiast blog (One Camera One Lens), which has published many strongly pro-RapidRAW posts;
  - aggregator sites with thin original content.
- **Prevalence tags.** These are my judgement from the number of *independent* sources found. They are not measured statistics.
  - **[very common]**: raised by professional reviewers *and* several independent community threads, often across years.
  - **[recurring]**: two or more independent sources.
  - **[one-off]**: one source or anecdote.
- **No invented numbers.** Every figure below (reaction counts, survey percentages, timings) is reported exactly as the cited source gave it.

---

## 1. darktable

Versions in this period: 4.2 (Dec 2022) added sigmoid. 5.0 (Dec 2024). 5.2 (Jun 2025) made sigmoid the default. 5.4 (Dec 2025) added AgX and workspaces. 5.4.1 (Feb 2026). 5.6 (21 Jun 2026) added optional AI masks.

### 1.1 Praised features and capabilities

- **Masking power: drawn and parametric masks combined, available in almost every module. [very common]**
  - Forum users call darktable masking "more flexible and more powerful" than Lightroom's, while adding that it "takes real practice". https://discuss.pixls.us/t/is-there-anyone-who-would-like-to-provide-some-extensive-reviews-between-darktable-and-rawtherapee/4869/11 (older thread, undated in excerpt)
  - A user who keeps switching between darktable and commercial tools returned to darktable for a large print. The reason was that the combination of parametric and drawn masks was more powerful than Lightroom's AI selections. https://discuss.pixls.us/t/darktable-is-my-photoshop-gas-in-software/39603
  - A pixls.us comparison lists "masking, and lots of it" as darktable's main advantage over RawTherapee. https://discuss.pixls.us/t/rawtherapee-vs-darktable/8701
- **Depth of control and image quality for people willing to learn. [very common]**
  - A reviewer found it "more polished and has more features than I realized", with "much more direct fine-grained control in many cases". https://havecamerawilltravel.com/workflow/darktable-raw-image-processing/ (undated)
  - Defenders on Hacker News (HN) say "many artists want to understand exactly what happens to their pixels". https://news.ycombinator.com/item?id=42558037 (darktable 5.0.0 thread, c. Dec 2024/Jan 2025)
  - A longtime user credits the sigmoid module with fixing his trouble with a new camera. https://discuss.pixls.us/t/improvement-suggestions/48670/101
- **Free, no subscription, cross-platform, Linux-native. [very common]**
  - Lightroom-alternative roundups and switcher threads cite cost and Adobe's subscription as the trigger for trying it. https://havecamerawilltravel.com/photographer/lightroom-alternatives/, https://discuss.pixls.us/t/making-the-switch-from-lightroom-to-darktable/38489
  - Vendor-written pages (Imagen AI) say the same; they are flagged as biased. https://imagen-ai.com/post/free-alternative-lightroom/
- **It repays the effort for some users. [recurring]**
  - "Once you get it, everything clicks into place." The excerpt did not show which of these two forum comments it came from: https://blendit.bsd.cafe/comment/1587554, https://lemmy.klein.ruhr/post/89253/460568
  - One switcher was editing about 20% slower at first and later matched their Lightroom speed. https://discuss.pixls.us/t/making-the-switch-from-lightroom/3563
  - A 2025 new user said darktable was initially hard to reach a "pretty good" baseline with, but it "really helped me move towards great". https://discuss.pixls.us/t/whats-so-hard-about-darktable/60697 (thread c. Sep 2026, quoting an older post)
- **Reference documentation is good. [recurring]**
  - The 2025 "New User Thoughts" post praises the module manual pages. The criticism is that they explain *what* a module does, not *when or why* to use it. https://discuss.pixls.us/t/new-user-thoughts-on-darktable-after-a-month/49785, cross-posted at https://www.pentaxforums.com/forums/32-digital-processing-software-printing/478947-thoughts-darktable-after-month.html (30 Apr 2025)
  - A 2026 HN front-page thread ("Darktable", 271 points and 132 comments per the pixls.us post about it) included praise for the documentation. https://news.ycombinator.com/item?id=49096654, https://discuss.pixls.us/t/darktable-on-the-first-page-of-hacker-news/59525 (Jul 2026)
- **AI object masks in 5.6 were welcomed. [recurring, but early]**
  - pixls.us users: "the AI masks are really helpful". A self-described weak masker expects them to help. https://discuss.pixls.us/t/meet-the-new-ai-tools-in-darktable-5-6/58819 (Jun 2026)
  - The feature is opt-in. It needs a build flag (`-DUSE_AI=ON`) and enabling in preferences. https://docs.darktable.org/usermanual/5.6/en/darkroom/masking-and-blending/masks/ai-masking/, https://linuxiac.com/darktable-5-6-open-source-raw-editor-brings-optional-ai-tools/
  - Users asked about hardware; one reply suggested a dedicated GPU with at least 4 GB of VRAM.

### 1.2 Usability and UI complaints

- **Steep learning curve, and little transfers from Lightroom. [very common]**
  - The project itself says so. The official FAQ states the learning curve "can be steep, since very little workflow and tool knowledge can be transferred from other programs". It also says it would be "a mistake" to think darktable is a direct Lightroom replacement. https://www.darktable.org/about/faq/
  - Phoblographer (Oct 2022) cites "the number of different controls and cluttered user interface". It adds that even after learning it, "many edits will take much longer than other editing apps". https://www.thephoblographer.com/2022/10/03/darktable-review-free-lightroom-alternative/
  - PetaPixel's 5.0 news piece (23 Dec 2024) says it is "easier to use than before" but notes it has often had "a steep learning curve and occasional inconsistencies". https://petapixel.com/2024/12/23/powerful-free-raw-photo-editor-darktable-just-got-a-big-upgrade
  - Galaxus (2026, written against 5.6) is titled "Raw developer darktable leaves me completely in the dark". https://www.galaxus.de/en/page/raw-developer-darktable-leaves-me-completely-in-the-dark-43115
  - A Lemmy user has tried it "8 or 10 times over the years" but "can't get my head around it" and keeps going back to RawTherapee. https://ui.lemm.ee/post/18816761 (top result for the quote; attribution taken from the search summary)
  - The same sentiment appears on HN: https://news.ycombinator.com/item?id=42558037
- **Too many modules, with several overlapping ways to do the same thing. [very common]**
  - darktable's own "howto in 5.0" post (Dec 2024) says the "large number of processing modules and many different ways of accomplishing the same goal often leaves first-time users feeling overwhelmed". Its advice is to start with only the quick access panel and crop. https://darktable.org/2024/12/howto-in-5.0
  - A user on HN, a month in, still can't tell which module they need for a given result. https://news.ycombinator.com/item?id=42558037
  - A pixls.us user abandoned darktable over "many overlapping modules, often with different names". https://discuss.pixls.us/t/is-darktable-or-any-photo-soft-ever-too-complicated/16275
  - One Camera One Lens (Aug 2026, pro-RapidRAW bias) cites "endless sub-menus and duplicate tools, academic terminology, and sluggish UI performance". https://onecameraonelens.com/2026/08/04/stop-spending-time-editing-in-convoluted-photo-editors-like-darktable-and-rawtherapee-and-use-rapidraw/
  - The 2023 HN thread on the Ansel fork says the old UI had too many duplicated features. https://news.ycombinator.com/item?id=38390914
- **Tone mapping: filmic vs sigmoid vs base curve, now also AgX. [very common]**
  - The Sep 2026 pixls.us thread "what's so hard about darktable" lists this first. Filmic, sigmoid and base curve all sit in the default layout although an edit needs only one. Users build custom module groups to hide the unused ones "so they don't stack by accident". The proposed fix: using one should hide the others. https://discuss.pixls.us/t/whats-so-hard-about-darktable/60697
  - One Camera One Lens (Jan 2023) says sigmoid "has caused some confusion" because the two give quite different results. https://onecameraonelens.com/2023/01/16/darktable-filmic-rgb-sigmoid-or-neither/
  - GitHub #14817 (Jul 2023): "Filmic and sigmoid both enabled with import". https://github.com/darktable-org/darktable/issues/14817
  - Galaxus (2026) calls AgX and Sigmoid "new, hard-to-understand modules". https://www.galaxus.ch/en/page/raw-developer-darktable-leaves-me-completely-in-the-dark-43115
  - **Status:** 5.2 (Jun 2025) made sigmoid the default tone mapper for *fresh installs* only. https://www.darktable.org/2025/06/darktable-5.2.0-released/, https://linuxiac.com/darktable-5-2-raw-photo-editing-tool-released/
  - 5.4 (Dec 2025) then added a *fourth* tone mapper, AgX. https://www.darktable.org/2025/12/darktable-5.4.0-released/
  - So the overlap has grown, not shrunk.
- **Scene-referred workflow confuses Lightroom migrants. [very common]**
  - A Lightroom switcher found "the scene-referred (filmic) workflow and finding the right modules" the hardest part. https://discuss.pixls.us/t/for-people-switching-from-lightroom-or-similar-software/44821
  - Galaxus says the version-3 shift to scene-referred processing was hard to follow, and that older modules "can't be used" in it. https://www.galaxus.de/en/page/raw-developer-darktable-leaves-me-completely-in-the-dark-43115
  - A pixls.us post (post 101) proposes a "hybrid default workflow": scene-referred before tone mapping, display-referred after. https://discuss.pixls.us/t/improvement-suggestions/48670/101
- **White balance vs color calibration. [recurring]**
  - In the stock config, the white balance module shows a warning steering users to color calibration.
  - The color calibration CAT tab "doesn't have a normal green/magenta tint slider". https://discuss.pixls.us/t/whats-so-hard-about-darktable/60697 (c. Sep 2026)
  - HN (Jul 2025): opening "white balance" in the stock configuration produces an error, and users must use color calibration, which is "more powerful but needlessly obtuse". https://news.ycombinator.com/item?id=44508318
  - Separate pixls.us threads on the same confusion: https://discuss.pixls.us/t/white-balance-vs-color-calibration/57795, https://discuss.pixls.us/t/color-calibration-white-balance/57859 (2026)
- **Lightroom basics are hard to find. [recurring]**
  - GitHub #19084 "Make UI easier for beginners PLEASE" (14 Jul 2025, read in full) asks for an optional Lightroom/Capture One-style "beginner" layout, or task-based "windows". It was closed as *not planned*. https://github.com/darktable-org/darktable/issues/19084
    - Quote: "the fact I have to search for my highlight/shadow adjustment is really annoying"
  - GitHub #16677 (Apr 2024) posts a screenshot of Lightroom's Basic panel and asks "where can I find the module equivalent". It was closed as not planned. https://github.com/darktable-org/darktable/issues/16677
  - One switcher keeps returning to Lightroom because "a quick nudge on the Shadows slider" is faster than the darktable equivalent. https://discuss.pixls.us/t/darktable-is-my-photoshop-gas-in-software/39603
- **The "beginner" module preset is not much easier. [recurring]**
  - On pixls.us, the "beginner" preset "is not significantly less overwhelming than eg the scene-referred one".
  - A Reddit user says even the predefined beginner collection "seems to be still too much".
  - Both seen in excerpts linked from https://darktable.org/2024/12/howto-in-5.0, https://discuss.pixls.us/t/how-do-i-in-darktable-5-0/47202
- **Terminology and slider names. [recurring]**
  - "The UI is incredibly dense and the names of sliders don't make sense unless you're an image science expert." The excerpt did not show which of these two comments it came from: https://blendit.bsd.cafe/comment/1587554, https://lemmy.klein.ruhr/post/89253/460568
  - One Camera One Lens: "academic terminology" (see link above).
  - Pentax/pixls new user: wants guidance on *when and why*, not only *what*. https://discuss.pixls.us/t/new-user-thoughts-on-darktable-after-a-month/49785
- **The tone equalizer is hard to get right. [recurring]**
  - "I find TE very hard to get right, too." https://discuss.pixls.us/t/whats-so-hard-about-darktable/60697
  - GitHub #18928 (Jun 2025) asked to disable the tone equalizer's on-canvas mouse controls by default (2 thumbs-up). https://github.com/darktable-org/darktable/issues/18928
- **Masks are scattered across modules and hard to reuse. [recurring]**
  - "Masks end up scattered across modules"; to re-use and link masks "you have to use raster-masks". https://discuss.pixls.us/t/whats-so-hard-about-darktable/60697
  - Parametric masks "often spill over" and need drawn-mask cleanup. A Lightroom migrant finds simple drawn masks quicker in Lightroom. https://discuss.pixls.us/t/new-user-thoughts-on-darktable-after-a-month/49785
  - Parametric masks are tied to module input/output, so they are hard to save in presets. https://discuss.pixls.us/t/masks-are-not-stored-in-presets-or-styles/35290
- **The history stack is confusing. [recurring]**
  - The list shows the order you *touched* modules, not pipeline order. https://discuss.pixls.us/t/basic-use-of-history-stack-and-active-modules-panel/51231
  - "Compress history stack" discards everything above the selected step. https://docs.darktable.org/usermanual/4.6/en/module-reference/utility-modules/darkroom/history-stack/
  - Styles appear to apply in reverse order. https://discuss.pixls.us/t/modules-in-styles-are-being-applied-in-reverse-order/9837
- **Copy/paste of edits is not discoverable. [recurring]**
  - GitHub #22392 (25 Sep 2026, read in full): the selective-copy dialog is "disorienting and unwieldy", ordered by history position. Copy/paste "is not very discoverable in the darkroom unless one knows about the keyboard shortcuts". https://github.com/darktable-org/darktable/issues/22392
- **Mouse and keyboard interaction. [recurring]**
  - The 2025 new-user post: no right-click context menus, and custom shortcuts are hard to bind. https://discuss.pixls.us/t/new-user-thoughts-on-darktable-after-a-month/49785
  - Slider fine-control features "took a long time to discover". Trackpad scroll is oversensitive. Default UI scaling is wrong on high-DPI screens (older threads). https://discuss.pixls.us/t/implementation-of-bigger-sliders-with-markings/6341/17, https://discuss.pixls.us/t/implementation-of-bigger-sliders-with-markings/6341/18
  - Shift+scroll for mask feathering didn't work on macOS (older). https://discuss.pixls.us/t/scroll-wheel-problem-in-darktable-for-macos/9555
  - Small slider knobs were raised in older HN threads. https://news.ycombinator.com/item?id=21874528
- **Import and library concepts. [recurring]**
  - The import dialog's "add to library" vs "copy & import" puzzles newcomers. A Lemmy user called the import-then-add method "bizarre". https://lemmy.nowsci.com/comment/9481248, https://docs.darktable.org/usermanual/4.2/en/module-reference/utility-modules/lighttable/import/
  - "I find the filmroll concept a little tedious." Users say darktable "doesn't really manage files" and miss Lightroom's folder panel with virtual and smart collections. https://discuss.pixls.us/t/i-find-the-filmroll-concept-a-little-tedious/24603/9
  - In Aurélien Pierre's 2020 user survey (n = 1101, a skewed technical audience by the author's own description), file management was the *least* liked feature set at 43% satisfaction, then batch editing at 52%. Per a pixls.us post summarising the results. https://discuss.pixls.us/t/darktable-user-survey/16824?page=3, https://eng.aurelienpierre.com/2023/01/who-are-the-darktable-users-in-2020/
  - GitHub #12907 (Nov 2022) requested full file and folder management (DAM). https://github.com/darktable-org/darktable/issues/12907
- **Default rendering looks unfinished. [one-off, but notable]**
  - The 2025 new user: darktable "defaults to the minimum processing needed to show a RAW file". https://www.pentaxforums.com/forums/32-digital-processing-software-printing/478947-thoughts-darktable-after-month.html
- **Tutorials go stale as modules change. [recurring]**
  - Reddit (Oct 2024): darktable's workflow "is very different" and many YouTube tutorials are outdated. https://redlib.hbubli.cc/r/DarkTable/comments/1gb13ms/capture_one_to_darktable
  - Old guides use pre-"filmic rgb" names. Forums warn there are "far too many confusing and conflicting discussions recommending different modules". https://discuss.pixls.us/t/darktable-3-6-simple-working-instructions-needed/26063/59, https://discuss.pixls.us/t/beginner-workflow/28630
- **The UI redesign is stalled. [recurring, context]**
  - A community rebrand and UI-redesign thread exists. Commenters say a proper revamp waits on a GTK3→GTK4 migration (still waiting as of about Feb 2026). https://discuss.pixls.us/t/i-am-working-on-a-rebrand-for-darktable/44382
  - GitHub #19596 "UI redesign approach" (27 Oct 2025, 7 thumbs-up, the most-reacted UI issue in my search) asks how to implement it without leaving the UI inconsistent mid-way. https://github.com/darktable-org/darktable/issues/19596
  - Note: darktable GitHub issues get few reactions overall (single digits even for the top UI issues), so the counts say little about prevalence.
  - **Ansel**, a fork by former filmic/darktable developer Aurélien Pierre, exists largely as a UX protest. It is described as darktable 4.0 "minus the fluff, plus a design vision" and aims to stop darktable becoming "a Vim editor for image processing". https://aurelienpierre.com/en/portfolio/end-user/ansel/, https://news.ycombinator.com/item?id=38390914 (Nov 2023)

### 1.3 Pitfalls and dealbreakers

- **Perceived slowness or lag. [recurring]**
  - Phoblographer (20 Jun 2025, darktable 5.0, M1 Mac mini): basic slider adjustments lagged badly. After nearly an hour the reviewer was still on the first RAW file. They concluded it is not suited to professionals who need speed. https://www.thephoblographer.com/2025/06/20/is-darktable-5-0-finally-usable/
  - A 2019 iMac reviewer found it "a bit sluggish" and batch processing "more cumbersome and slower". https://havecamerawilltravel.com/workflow/darktable-raw-image-processing/
  - Windows OpenCL threads (mostly 2019–2021, darktable 3.x) report 1–2 s lag even on an RTX 3080 Ti, and OpenCL sometimes making things slower. https://discuss.pixls.us/t/help-with-lag-on-high-end-gpu/43701, https://discuss.pixls.us/t/darktable-3-4-3-5-opencl-slow-on-windows-10/25309
  - **Partly addressed:**
    - 5.0 (Dec 2024): faster import/export and a "more responsive feel" (PetaPixel, above).
    - 5.4 (Dec 2025): faster first startup.
    - 5.6 (Jun 2026): OpenCL optimisations and faster thumbnail cache builds. https://letsdatascience.com/news/darktable-releases-56-with-optional-ai-tools-01c7ca84
- **Crashes, especially on macOS. [recurring]**
  - 5.4.1 crash loops and random crashes on macOS Tahoe, M2 Pro (2026). https://discuss.pixls.us/t/5-4-1-constantly-crashing-on-macos/56898, https://discuss.pixls.us/t/darktable-5-4-1-random-crashes-on-macos-tahoe/57091
  - 4.4.2 freezes on import. https://discuss.pixls.us/t/darktable-4-4-2-for-mac-os-constantly-freezes/39129
  - Some Windows machines crash with OpenCL enabled. https://discuss.pixls.us/t/darktable-crashes-seconds-after-loading/56760
  - 5.6.2 fixed Windows crashes from faulty ONNX Runtime libraries. https://linuxiac.com/?p=220528
- **Library (database) vs XMP sidecar confusion and "lost" edits. [recurring]**
  - After import, the database takes precedence over the XMP file. Changes made by other software are not seen unless "look for updated xmp files on startup" is enabled. https://discuss.pixls.us/t/darktable-doesnt-see-updated-xmp-files-from-digikam/20983
  - Edits "might not be lost, just your database is out of sync". Recovery means removing images, restoring XMPs and re-importing. https://discuss.pixls.us/t/lost-edits-in-darktable/34548
  - Older thread: "Darktable looses all edits on crash?" https://discuss.pixls.us/t/darktable-looses-all-edits-on-crash/22655
  - Backups must include XMPs: https://docs.darktable.org/usermanual/5.2/en/overview/sidecar-files/sidecar/
  - 4.2: the film roll disappeared mid-session and an image showed artifacts. https://discuss.pixls.us/t/hitting-potholes-and-roadbumps-in-using-darktable-4-2/34926
  - After upgrading to 4.6, imports reported success but showed nothing. https://discuss.pixls.us/t/after-upgrade-to-darktable-4-6-imported-images-dont-appear-in-lighttable/41104
- **Library and config are not backward compatible across major versions. [recurring]**
  - Moving from 4.8 to 5.0, and from 5.4 to 5.6, keeps edits, but the new library and config can't be used by the older version. https://linuxiac.com/darktable-5-0-1-raw-photo-editing-tool-released/, https://www.darktable.org/2026/06/darktable-5.6.0-released/
- **Lightroom migration is only partial. [recurring]**
  - Importing Lightroom XMP gives "underwhelming" results for a 20,000-photo library because "the tools and their functions don't match up exactly".
  - A longtime user estimates the Lightroom import saves about 80% of the work per image.
  - Source for both: https://discuss.pixls.us/t/making-the-switch-from-lightroom/3563
- **People give up. [recurring]**
  - "I gave up on DARKTABLE….in fact I gave up on Linux too": three months of struggle, then bought ON1 Photo RAW. https://discuss.pixls.us/t/i-gave-up-on-darktable-in-fact-i-gave-up-on-linux-too/59526 (2026, date inferred from thread numbering)
  - "Why I've stopped using Darktable and use RapidRaw" (One Camera One Lens, 3 May 2026, pro-RapidRAW author): darktable is "far too convoluted" for client batches. https://onecameraonelens.com/2026/05/03/why-ive-stopped-using-darktable-and-use-rapidraw/
  - A Lemmy user said a task "took an hour to do something that would have taken 5 mins in Lightroom". https://lemmy.klein.ruhr/post/188544/791164

### 1.4 Recurring feature requests

- **An optional simple/beginner or "Lightroom-like" layout; "simple" and "professional" modes. [very common]**
  - GitHub #19084: https://github.com/darktable-org/darktable/issues/19084
  - HN 5.0 thread: https://news.ycombinator.com/item?id=42558037
  - pixls.us proposal for a "simple interface" tab: https://discuss.pixls.us/t/is-darktable-or-any-photo-soft-ever-too-complicated/16275
- **A first-run guide for new users. [recurring]** https://discuss.pixls.us/t/improvement-suggestions/48670/101
- **Hide the alternative tone mappers once one is in use. [recurring]** https://discuss.pixls.us/t/whats-so-hard-about-darktable/60697
- **A plain tint slider in color calibration. [recurring]** Same thread.
- **Visible copy/paste buttons and selective copy inside the history panel. [one-off, recent]** https://github.com/darktable-org/darktable/issues/22392
- **A customisable quick access panel order. [one-off]** https://github.com/darktable-org/darktable/issues/18550
- **Better file and folder management (DAM), and a better tagging UI. [recurring]**
  - #12907: https://github.com/darktable-org/darktable/issues/12907
  - #15172 "New UI for tagging module" (8 thumbs-up, the highest reaction count in the feature-request search): https://github.com/darktable-org/darktable/issues/15172
  - #19674 tagging keyboard navigation: https://github.com/darktable-org/darktable/issues/19674

### 1.5 Fixed or changed in 4.x–5.x (so LightBench should not over-index on old complaints)

- **3.4: module groups and a "quick access panel" became the default layout.** https://docs.darktable.org/usermanual/4.8/en/darkroom/organization/module-groups
- **4.0 (2022): UI revamp with the "Elegant Grey" default theme.** https://itsfoss.com/news/darktable-4-0-release/
- **4.2 (Dec 2022): sigmoid added**, described as giving good results "with fewer controls". https://librearts.org/2022/12/darktable-4-2/
- **5.0 (Dec 2024): a waveform scope became the default, a high-contrast theme was added, and Retouch and Tone Equalizer were updated.** https://alternativeto.net/news/2024/12/darktable-5-0-enhances-photo-editing-with-improved-ui-ux-and-performance-boosts
- **5.2 (Jun 2025): sigmoid became the default tone mapper for new installs, and the deprecated levels and contrast/brightness/saturation modules were removed.** https://linuxiac.com/darktable-5-2-raw-photo-editing-tool-released/
- **5.4 (Dec 2025): AgX, capture sharpening, multiple workspaces, new default shortcuts, and Wayland parity.** darktable.org also published a "beginner-friendly and simple workflow" how-to for 5.4. https://www.darktable.org/2025/12/darktable-5.4.0-released/, https://www.darktable.org/tags/howto/
- **5.6 (Jun 2026): optional local AI masking and denoise, and doubled darkroom preview resolution.** https://www.darktable.org/2026/06/darktable-5.6.0-released/
- **Net effect.** Despite these changes, the Sep 2026 "what's so hard about darktable" thread raises the same core issues: too many tone mappers, white balance vs color calibration, and scattered masks. **The learning-curve problem is current, not historical.**

---

## 2. RawTherapee

Versions: 5.8 (2020). 5.9 (2022) added local adjustments. 5.10 (2024). 5.11 (Aug 2024) renamed local adjustments to Selective Editing and added real HiDPI. 5.12 (28 May 2025).

### 2.1 Praised features and capabilities

- **Image quality and depth of processing for a free tool. [very common]**
  - Digital Camera World (DCW): results "not quite at the level of Adobe Camera Raw and Lightroom, but it's not too far off". https://www.digitalcameraworld.com/tech/software/rawtherapee-review (undated)
  - Shotkit lists RAW editing, HDR tone mapping and being free as pros. https://shotkit.com/rawtherapee-review/
  - G2 user reviews highlight the RAW engine. https://g2.com/products/rawtherapee/reviews?page=6
- **Highlight recovery and noise reduction. [recurring]**
  - pixls.us users rate RawTherapee's highlight reconstruction and noise reduction above darktable's. https://discuss.pixls.us/t/rawtherapee-vs-darktable/8701
- **Good results with little effort via the "Auto-Matched Tone Curve". [recurring]**
  - The curve is derived from the camera's embedded JPEG. A user who returned from darktable called it "a brilliant addition". Another got better-looking files with only that curve than with a full darktable edit. https://discuss.pixls.us/t/rawtherapee-already-very-good-even-without-sharpening-and-denoise/9112
  - It has known weak spots: heavily cropped or distorted embedded JPEGs, and some Fuji files. https://discuss.pixls.us/t/rawtherapee-5-5-auto-matched-tone-curve-very-light/11647
- **Cleaner menus than darktable for some users. [recurring]**
  - "Menu structure is much cleaner", curves are easier. One user found darktable "hard work" but RawTherapee's controls "easy and intuitive". https://discuss.pixls.us/t/rawtherapee-vs-darktable/8701, https://discuss.pixls.us/t/is-there-anyone-who-would-like-to-provide-some-extensive-reviews-between-darktable-and-rawtherapee/4869
  - Linux Pro Magazine says it "feels quicker when editing". https://www.linuxpromagazine.com/index.php/Issues/2020/231/FOSSPicks/(offset)/3
  - On HN (Jul 2025) a commenter calls it "the best raw image processing tool I know". https://news.ycombinator.com/item?id=44506692
- **Works as a GIMP raw importer. [recurring]**
  - Shotkit calls it "one of the best GIMP plugins" (above).
  - The GIMP 3 handoff works (see the GIMP section).
- **Progressive disclosure inside Selective Editing. [one-off, but directly relevant]**
  - Local-adjustment modules switch between **Basic, Standard and Advanced** complexity modes. https://rawpedia.rawtherapee.com/Local_Adjustments

### 2.2 Usability and UI complaints

- **The interface is complicated, with hundreds of parameters. [very common]**
  - DCW cons: "complicated interface", "possibly too many controls", workflow "took a lot of getting used to" (above).
  - Shotkit: "complex interface for beginners" (above).
  - Aiarty (vendor) says "hundreds of parameters can appear intimidating". https://www.aiarty.com/edit-photo/rawtherapee-review.htm
  - LWN (Jonathan Corbet, 7 Feb 2022): "in some ways simpler than darktable — but that is not the same as saying that it is simple". https://lwn.net/Articles/883599/
- **Sliders "do nothing" until the tool is enabled. [recurring]**
  - "Adjusting any slider in the Noise reduction or Graduated filter section seems not to have any effect." The cause is that the tool must be switched on first, which one contributor calls "awkward". A request to auto-enable "has not gotten any traction". https://discuss.pixls.us/t/solved-some-settings-e-g-noise-reduction-graduated-filter-show-no-effect/3389
- **Some effects only render at 100% zoom. [recurring]**
  - Noise reduction and similar tools are computed only at 100% zoom for speed, so changes are invisible when zoomed out. https://discuss.pixls.us/t/raw-photography-and-noise/276/23
  - A pixls.us user calls viewing modules at 100% their main obstacle. https://discuss.pixls.us/t/is-there-anyone-who-would-like-to-provide-some-extensive-reviews-between-darktable-and-rawtherapee/4869/12
- **No control over processing order, and no repeated instances. [one-off, LWN]**
  - "No visibility into (or control over) the order in which they are applied". The reviewer judges this unlikely to bother beginners. https://lwn.net/Articles/883599/
- **Requests for simpler controls. [one-off]**
  - Users asked for a "Reduced wavelets-noise slider which just works". A developer answered that RawTherapee "does not pretend to want to be a replacement for ACR". https://discuss.pixls.us/t/where-is-the-missing-gui/20250?page=2
- **Few tutorials. [one-off]** Shotkit lists a shortage of tutorials as a con (above).

### 2.3 Pitfalls and dealbreakers

- **Slow performance. [recurring]**
  - DCW con: "slow performance" (above).
  - G2: slow on less powerful systems (above).
  - Capterra: "hardware hungry". https://www.capterra.com/p/234579/RawTherapee/reviews/
- **Slow file browser on first open; no catalogue or real culling. [recurring]**
  - First visit to a 6,934-file folder took 12 minutes, then under 30 s once cached. https://discuss.pixls.us/t/incredibly-slow-file-browser-and-rt-not-using-cpu/14219/8 (RawTherapee 5.5–5.7 era; 5.7 sped this up)
  - Users who want fast rating and culling go to external tools such as Geeqie. https://discuss.pixls.us/t/rawtherapee-workflow-preview-and-rate-images-in-filebrowser/7334
- **Development momentum and bus factor. [recurring, partly outdated]**
  - LWN (2022) found development slowing, with one developer (Jacques Desmis) responsible for 62% of post-5.8 changes. https://lwn.net/Articles/883599/
  - A Lemmy commenter claims development "has pretty much stopped". The excerpt did not show which comment in this thread it came from: https://lemmy.klein.ruhr/post/80569/430599, https://lemmy.klein.ruhr/post/80569/431365
  - **Update:** 5.11 (Aug 2024) and 5.12 (May 2025) did ship. https://alternativeto.net/news/2024/9/rawtherapee-5-11-released-with-hidpi-support-extanded-compatibility-and-many-improvements, https://discuss.pixls.us/t/rawtherapee-5-12-released/50494
- **Local editing arrived late. [recurring, now fixed]**
  - In 2021 LWN commenters called the lack of local adjustments "the major drawback". https://lwn.net/Articles/861844
  - Local adjustments shipped in 5.9 and became "Selective Editing" in 5.11.
- **Denoising lags Lightroom for some users. [one-off]**
  - One HN commenter moved from RawTherapee to Lightroom "because the denoising is so m[uch better]" (excerpt truncated). https://news.ycombinator.com/item?id=44514206
- **Slower support for new cameras. [one-off]** DCW (above).

### 2.4 Recurring feature requests and the ART fork

- **Simpler, "just works" controls, and auto-enabling a tool when a slider moves. [recurring]** See the threads above.
- **ART ("Another RawTherapee")** trades "a bit of customization and control … for a simpler and (hopefully) easier to use interface". It restructured the UI and pipeline, added drawn and parametric masks, and borrowed darktable's auto-perspective tool. It is evidence that simplification is a recognised unmet need in this user base. https://linuxlinks.com/art-fork-rawtherapee, https://software.opensuse.org/package/ART

---

## 3. RapidRAW

RapidRAW is a newer, Lightroom-like open-source editor built with Rust, Tauri and React, by Timon Käch ("CyberTimon"), who started it at 18. It was public from about mid-2025. Releases run 1.2 (Jul 2025) → 1.4.4 (AgX) → 1.4.9 (Lensfun, 26 Jan 2026) → 1.5.6 (albums, filtering, i18n) → 1.6.0 (26 Jul 2026, headless CLI export) → 1.6.5 (Oct 2026).

### 3.1 What it does differently in UX

- **Lightroom (cloud)-style single-screen editor with a "gentle learning curve" as an explicit goal.**
  - The developer's pixls.us introduction describes the priorities as a "user friendly experience with a clean UI and a gentle learning curve". https://discuss.pixls.us/t/introduction-rapidraw-a-gpu-accelerated-open-source-raw-editor/53585
  - XDA says it "resembles the very best parts of Lightroom CC". https://www.xda-developers.com/this-free-lightroom-replacement-better-ux-than-darktable/
  - A Lemmy/PieFed poster frames it as "RapidRAW ≠ Darktable", in the same way Lightroom ≠ Lightroom Classic. https://piefed.jeena.net/post/218154
- **GPU-accelerated, small and fast-feeling.** Under 20–30 MB. https://thephoblographer.com/2025/07/09/rapidraw-an-open-source-alternative-to-adobe-lightroom, https://onecameraonelens.com/2025/07/07/a-new-free-and-open-source-raw-editor-is-in-development-and-its-looking-great/
- **AI masks first.**
  - Subject, sky and foreground detection using local models, combined with brush, linear and radial masks.
  - Depth-based masks were added in 1.5.3.
  - Sources: https://www.linuxlinks.com/rapidraw-non-destructive-gpu-accelerated-raw-image-editor, https://www.neowin.net/amp/rapidraw-153/
- **No import step (inferred).**
  - It browses folders, with ratings, metadata and an EXIF viewer.
  - Edits go to a per-image `.rrdata` sidecar.
  - My inference: no source explicitly says "no catalogue", but the folder-browse model and sidecar-only storage imply it. https://www.neowin.net/amp/rapidraw-160/
- **Optional generative edits through a ComfyUI backend, and AgX tone mapping (1.4.4).** https://www.neowin.net/amp/rapidraw-144/, https://discuss.pixls.us/t/rapidraw-adds-agx-color-management-inspired-by-blender-and-darktable/53879/2
- **Honest scoping.**
  - The README says it is "not yet as polished" as darktable, RawTherapee or Lightroom.
  - It is "not for users who seek absolute, perfect color accuracy".
  - https://hysenlabs.com/projects/cybertimon-rapidraw, https://discuss.pixls.us/t/rapidraw-a-new-foss-raw-processor/51107

### 3.2 Reception: praise

- **"UX blows darktable's out of the water." [very common among Lightroom refugees and tech press]**
  - XDA: darktable is competitive but "its overly complex UI favors experts and alienates novices". RapidRAW is "my favorite open-source alternative to Lightroom". https://www.xda-developers.com/this-free-lightroom-replacement-better-ux-than-darktable/, https://www.xda-developers.com/rapidraw-free-open-source-lightroom-alternative-been-waiting-for/
  - A Reddit r/photography user, quoted verbatim in GitHub #26 (Jul 2025, read in full): "I never really fell in love with darktable, that just feels really unwieldy and unintuitive at times." https://github.com/CyberTimon/RapidRAW/issues/26
  - DPReview: "the FastStone of Raw editors" for ease of use relative to capability. https://www.dpreview.com/forums/threads/rapidraw-open-source-lightroom-alternative-for-mac-windows-linux.4809461/latest
  - A Japanese review: darktable "heavy and not intuitive", but they "could switch to RapidRAW right away". https://note.com/aiwaribiki/n/n41a6680fb9bd?hl=en
  - One Camera One Lens (May and Aug 2026; enthusiastic author, treat as biased) switched from darktable for speed and reliability. https://onecameraonelens.com/2026/05/03/why-ive-stopped-using-darktable-and-use-rapidraw/
- **Fast development and responsiveness to feedback. [recurring]**
  - DPReview users note the rapid release cadence (above).
  - A German forum headline notes it is supported by "70 developers" as of 1.5.6. https://nikon-fotografie.de/community/threads/neu-rapidraw-v1-5-6-projekt-mittlerweile-unterst%C3%BCtzt-von-70-entwicklern-und-diversen-github-projekten-einige-neue-features.314596/
- **Masking is a strength. [recurring]** "The masking is strong." https://discuss.pixls.us/t/introduction-rapidraw-a-gpu-accelerated-open-source-raw-editor/53585?page=4

### 3.3 Reception: criticism and pitfalls

- **Image quality and processing depth lag darktable and RawTherapee. [recurring]**
  - pixls.us: image quality "doesn't yet match darktable". Algorithms "tend to produce low quality results (highlights/shadows, HSL mixer)". AI masks suffer from an old SAM model and lack feathering. https://discuss.pixls.us/t/rapidraw-a-new-foss-raw-processor/51107
  - XDA: "hard to recommend RapidRAW right now if you need images to keep a decent level of detail and sharpness" (earlier version). https://www.xda-developers.com/rapidraw-free-open-source-lightroom-alternative-been-waiting-for/
  - Phoblographer (9 Jul 2025): 3/5, "one-person effort", "needs a lot more work". https://thephoblographer.com/2025/07/09/rapidraw-an-open-source-alternative-to-adobe-lightroom
  - abit.ee (Mar 2026): incomplete RAW support, functionality behind darktable and RawTherapee. https://abit.ee/en/soft/graphics-software/rapidraw-raw-photo-editor-lightroom-rust-gpu-lensfun-comfyui-open-source-en
  - One Camera One Lens (Dec 2025) calls it "a bit too lightweight" next to darktable and RawTherapee, though "a stepping stone". https://onecameraonelens.com/2025/12/15/your-choice-free-photo-editors-to-replace-adobe-in-2025/
  - **Later releases addressed parts of this:** BM3D denoise (1.4.7), a new raw preprocessing step for colour noise and sharpness (1.4.11), and a masking redesign (1.5.1). https://www.neowin.net/amp/rapidraw-147/, https://www.neowin.net/software/rapidraw-1411/
- **Trust concerns: "vibe coded", colour management. [recurring on Lemmy, disputed]**
  - "Vibe coded in two weeks. It doesn't have color managed." Others call that criticism unfounded. https://piefed.jeena.net/post/218154/comment/3700690
  - A German forum notes Google Gemini was used in development. https://nikon-fotografie.de/community/threads/rapidraw-raw-bildeditor-ist-nun-in-version-1-25-freigegeben-open-source-f%C3%BCr-alle-plattformen.312239/
  - I could not verify the colour-management claim either way.
- **Performance with large folders, and Linux UI lag. [recurring]** GitHub issues:
  - #307: 2000+ DNG folder pins the CPU. https://github.com/CyberTimon/RapidRAW/issues/307
  - #412: excessive memory on many folders. https://github.com/CyberTimon/RapidRAW/issues/412
  - #972: "Loading a folder takes forever" (Apr 2026). https://github.com/CyberTimon/RapidRAW/issues/972
  - #1448: poor first scan on HDD (Jul 2026). https://github.com/CyberTimon/RapidRAW/issues/1448
  - #1234: request to persist thumbnails. https://github.com/CyberTimon/RapidRAW/issues/1234
  - #280: "UI Performance on Linux sluggish". https://github.com/CyberTimon/RapidRAW/issues/280
  - PieFed: the interface "lags like hell under linux". https://piefed.jeena.net/post/218154
- **Sidecar handling. [recurring]**
  - #580: users dislike `.rrdata` files cluttering organised folders and want a configurable location (11 comments). https://github.com/CyberTimon/RapidRAW/issues/580
  - #1893 (10 Oct 2026, read in full): sidecars are written even when nothing changed (opening crop, undo back to original). The "edited" check "fails open". https://github.com/CyberTimon/RapidRAW/issues/1893
  - #459: crash on Windows when opening a folder with sidecars made on Linux. https://github.com/CyberTimon/RapidRAW/issues/459
  - #26: copying adjustments sometimes wiped the star rating of the target image. https://github.com/CyberTimon/RapidRAW/issues/26
- **Missing Lightroom-ecosystem features. [one-off]**
  - Cross-device sync was cited as a reason to stay with Adobe. https://piefed.jeena.net/post/218154
  - Users ask whether the DAM is enough compared with Lightroom Classic. https://cameraderie.org/threads/rapidraw-editing-software.59813/latest

### 3.4 Recurring feature requests (from GitHub; reaction counts from the API, Oct 2026)

- **#26** (Jul 2025, compiled from Reddit, 8 thumbs-up), read in full. The asks are a useful checklist of "Lightroom-feel" details:
  - white balance in **Kelvin** and exposure in **stops** "instead of 0-100";
  - **double-click a slider to reset** ("one thing I really like about darktable");
  - filter by rating;
  - clipping-indicator toggle;
  - space-to-zoom centred on the cursor;
  - faster A/B flipping and a side-by-side compare;
  - default crop ratio "original";
  - no auto-zoom on entering crop;
  - auto-crop after rotate;
  - vignette direction matching intuition;
  - a simple B&W tool;
  - EXIF summary (ISO, aperture, shutter, focal length) next to the file name.
  - https://github.com/CyberTimon/RapidRAW/issues/26
- **#714 side-by-side original vs edited (6 thumbs-up).** https://github.com/CyberTimon/RapidRAW/issues/714
- **#533 Lightroom import (3 thumbs-up, 4 hearts).** https://github.com/CyberTimon/RapidRAW/issues/533
- **Other requests:**
  - #95 C-41 negative conversion: https://github.com/CyberTimon/RapidRAW/issues/95
  - #1539 more NR and sharpening options: https://github.com/CyberTimon/RapidRAW/issues/1539
  - #504 metadata editing: https://github.com/CyberTimon/RapidRAW/issues/504
  - #555 parameter-based (parametric) masks: https://github.com/CyberTimon/RapidRAW/issues/555
  - #75 group JPEG+RAW: https://github.com/CyberTimon/RapidRAW/issues/75
  - #119 watermark: https://github.com/CyberTimon/RapidRAW/issues/119
  - #588 font size: https://github.com/CyberTimon/RapidRAW/issues/588
- **Pattern.** As RapidRAW matures, users ask for darktable-class depth (parametric masks, more NR and sharpening controls). Simplicity wins users first, then depth has to grow without breaking the simple surface.

---

## 4. digiKam (relevant to the LightBench Library module)

Versions: 8.5 (native Apple Silicon). 8.6 (Mar 2025; new face classifier, aesthetic rating). 8.7 (Jun 2025). 8.8 (Oct 2025). 9.0 (Mar 2026, Qt 6). 9.1. https://www.digikam.org/news/2025-03-15-8.6.0_release_announcement/, https://planet.kde.org/digikam-2025-06-30-digikam-8-7-0-is-released, https://alternativeto.net/software/digikam/news

### 4.1 Library and DAM praise

- **A serious free DAM for large libraries. [recurring]**
  - A DPReview user moved their DAM from Lightroom Classic and "can do in DigiKam everything I used the LR DAM features for". The same post notes the open-source vibe means it is not always polished. https://www.dpreview.com/forums/post/66005452
  - A DxO forum post lists it among the few serious consumer-priced DAMs. https://forum.dxo.com/t/any-experience-with-digikam-as-a-frontend-to-pl/33551
  - Futura (2025) cites its "capacity to handle large volumes of photos". https://www.futura-sciences.com/tech/definitions/logiciels-digikam-27013/
- **Tagging, face recognition, geolocation and maps. [recurring]**
  - The 8.6 face classifier is described as "both faster and more accurate". https://www.digikam.org/news/2025-03-15-8.6.0_release_announcement/
  - Tagging is the core organising workflow. https://www.digikam.org/about/features/
  - An XnView forum user rates digiKam better for keyword tagging. https://forum.xnview.com/viewtopic.php?p=185895
- **Pairs with a separate raw editor. [very common]**
  - Users run digiKam for DAM plus darktable or RawTherapee for development. The built-in raw conversion is "pretty basic IMHO and still fairly clunky". https://www.dpreview.com/forums/post/66005452, https://discuss.pixls.us/t/workflow-digikam-darktable/19377, https://www.talkphotography.co.uk/threads/digikam-and-darktable.705973/

### 4.2 Usability and UI complaints

- **Cluttered layout with four bars around the image. [recurring]**
  - KDE Discuss "digiKam is awesome! But the UI is a mess": the side bars can't be removed and vertical tab text gets cut off. https://discuss.kde.org/t/digikam-is-awesome-but-the-ui-is-a-mess/16150
  - A Mar 2026 KDE bug "Declutter sidebars" was closed as RESOLVED INTENTIONAL. https://bugs.kde.org/show_bug.cgi?id=518072
  - Older requests to merge the tags, description and properties sidebars ("confirmed by popular vote"): https://bugs.kde.org/show_bug.cgi?id=377857
- **Confusing terminology for folders. [recurring]**
  - An XnView forum excerpt says the confusion comes from "fifteen different terms that all simply mean a plain old folder". The wording was seen in one search excerpt and could not be re-confirmed verbatim. https://forum.xnview.com/viewtopic.php?p=185895
  - pixls.us: "in digikam, it appears that Albums = folders". https://discuss.pixls.us/t/digikam-albums-are-actually-folders-so-where-are-the-collections-albums/19309
- **Steep learning curve; simple features are hard to find. [recurring]**
  - AlternativeTo reviewer: "The user-experience has a (too) steep learning curve." https://www.alternativeto.net/software/digikam/about/
  - The same camera settings appear in two places. https://bugs.kde.org/show_bug.cgi?id=168253
- **Folder-tree navigation is weak for quick single-image work. [one-off]**
  - Compared unfavourably to FastStone and XnView. https://discuss.pixls.us/t/digikam-needs-folder-tree-navigation-capabilities/26228

### 4.3 Pitfalls and dealbreakers

- **Deleting an album deletes the folder on disk. [one-off, but high-severity]**
  - A digiKam 7 user found this out. https://discuss.pixls.us/t/digikam-albums-are-actually-folders-so-where-are-the-collections-albums/19309
- **Startup and scan slowness, with regressions between versions. [recurring]**
  - 8.2 on Windows: startup went from about 1 min to about 5 min; fixed toward 8.3. https://discuss.pixls.us/t/digikam-8-2-0-is-released/40761/19
  - 8.2 on Linux with photos on a NAS: scan went from about 51 s to over 20 min; "fast scan" fixed it. https://discuss.pixls.us/t/digikam-8-2-scanning-for-new-entries-very-slow/40851
  - 8.6 reported 4× slower startup with a suspected leak (r/FOSSPhotography via mirror). https://pol1.lr.ggtyler.dev/r/FOSSPhotography/comments/1jzzcve/digikam_bug_or_is_it_just_me
  - Remote MySQL over WiFi: 2 min to start (7.8). https://forum.kde.org/viewtopic.php%3Ff=255&t=176037.html
  - Face-tag queries take 10–12 s on a database of about 400K images; a composite index cut this to 1–2 s (Apr 2026). https://bugs.kde.org/show_bug.cgi?id=519125
- **Database corruption and tag loss. [recurring historically; mostly old bugs]**
  - Examples: https://bugs.kde.org/show_bug.cgi?id=375346 (fixed in 5.8), https://bugs.kde.org/show_bug.cgi?id=361922, https://bugs.kde.org/show_bug.cgi?id=277247
  - The lead developer advises SQLite integrity checks and the migration tool to rebuild. An aggregator mentions Windows database corruption. https://www.stork.ai/en/digikam
- **Interop with darktable XMP is fiddly. [recurring]**
  - Sidecar naming must be `name.EXT.xmp`.
  - darktable ignores external XMP changes unless configured to look for them.
  - Star ratings sync, but colour labels do not (needs Lua).
  - "Exporting metadata in digiKam will overwrite the changes of darktable".
  - Sources: https://discuss.pixls.us/t/synchronizing-between-digikam-and-darktable/33704, https://discuss.pixls.us/t/darktable-doesnt-see-updated-xmp-files-from-digikam/20983, https://discuss.pixls.us/t/sync-rating-to-xmp/40279

### 4.4 Recurring feature requests

- **A decluttered or customisable sidebar layout. [recurring]** KDE Discuss 16150; bugs 518072 and 377857 (above).
- **Real virtual albums or collections separate from folders. [recurring]** https://discuss.pixls.us/t/use-case-need-for-virtual-albums/19319/4
- **Faster, more selective scanning at startup. [recurring]** https://bugs.kde.org/show_bug.cgi?id=345643

---

## 5. GIMP (photo-editing UX only)

Versions: 3.0 (Mar 2025), 3.0.x through 3.0.8, 3.2 (Mar 2026).

- **Non-destructive filters in 3.0 were the headline change for photographers. [very common]**
  - Most GEGL filters, including Curves and Hue-Saturation, stay live and re-editable from the layer's Fx list and are saved in XCF.
  - "Merge Filters" restores the old destructive behaviour.
  - Reviewers had called the lack of non-destructive editing "a major roadblock for many photographers".
  - Sources: https://www.techradar.com/pro/our-favorite-free-photo-editor-finally-got-the-update-it-deserves-and-these-are-the-top-5-features-designers-should-know-about, https://osnews.com/?p=141947, https://www.webpronews.com/gimp-3-0-and-3-2-deliver-long-awaited-fixes-that-silence-decades-of-complaints/
- **Still no native adjustment layers, and non-destructive editing has gaps. [recurring]**
  - The adjustment-layer and layer-effects project (GSoC 2023) was not finished in the GUI. https://gitlab.gnome.org/GNOME/gimp/-/issues/9244
  - Users "cannot copy the setting of a non-destructive filter and paste it on another layer". https://gitlab.gnome.org/GNOME/gimp/-/issues/10563
  - A 2026 third-party plugin fakes adjustment layers with pass-through groups. https://discuss.pixls.us/t/adjustment-layers-in-gimp-3-2-a-plugin/61055
  - 3.2 (Mar 2026) added *link layers* (an external file kept live) and *vector layers*, not adjustment layers. https://www.gimp.org/release-notes/gimp-3.2.html, https://linuxiac.com/gimp-3-2-released-with-non-destructive-editing-and-vector-layers/
- **The interface is still "fairly clunky". [recurring]**
  - Creative Bloq (3.0 review): "interface remains fairly clunky and many features and tools are absent", but it is now "a viable free alternative" for those who don't need Adobe's most sophisticated tools. https://creativebloq.com/photography/photo-editing-software/gimp-3-0-review-20-years-on-from-2-0-has-gimp-kept-up-with-the-times
  - One small fix praised: Ctrl+V now pastes as a new layer instead of a floating selection. This is from a search summary of 3.0 reviews and the exact article was not shown; the likely source is https://www.webpronews.com/gimp-3-0-and-3-2-deliver-long-awaited-fixes-that-silence-decades-of-complaints/
  - The GTK3 port brings proper HiDPI and Wayland support. https://onecameraonelens.com/2025/03/25/gimp-3-0-2-review-a-welcome-step-forward-but-still-room-to-grow/
- **Single-window mode is old news, though often misreported. [one-off correction]**
  - Single-window mode arrived as an *option* in GIMP 2.8 (2012), with multi-window still the default at the time. https://GIMP.org/release-notes/gimp-2.8.html, https://fedoraproject.org/wiki/Features/GIMP_2.8
  - A 2025 Spanish news piece claims 3.0 "replaced" floating windows. I could not confirm that, so treat it as unverified. https://es.digitaltrends.com/?p=1096473
  - The persistent Photoshop-switcher complaint is unfamiliar layout and shortcuts rather than windows per se. The community answer is the PhotoGIMP patch, reportedly unmaintained for about two years. https://wwwhatsnew.com/?p=494344, https://lemmy.uninsane.org/post/161754/175984
- **The RAW handoff to darktable or RawTherapee is fragile. [recurring]**
  - The RawTherapee route works in GIMP 3: "Close and the image is sent back to Gimp as expected". https://www.gimp-forum.net/printthread.php?tid=11476, https://rawpedia.pixls.us/gimp_plugin/
  - The darktable route failed for a GIMP 3.0.8 + darktable 5.4.1 user on Windows ("unable to open"). The workaround is exporting a 16-bit TIFF. https://www.gimp-forum.net/printthread.php?tid=11476
  - Under Flatpak, GIMP can't see darktable at all, so community Python plugins exist. https://discuss.pixls.us/t/python-plug-in-for-gimp3-import-raw-with-darktable/57878, https://discuss.pixls.us/t/python-plug-in-for-gimp3-import-raw-with-rawtherapee/57941
  - Older: GIMP not listing darktable as an importer. https://gitlab.gnome.org/GNOME/gimp/-/issues/9267
- **Implication for LightBench.** "Edit in external editor" should be a first-class round trip: export a 16-bit TIFF in a wide gamut, re-import it as a linked derivative, and stack it with the RAW. Do not rely on plugin discovery.

---

## 6. Cross-app synthesis: top 15 usability lessons for LightBench

Each lesson lists the evidence behind it. Section numbers refer to the findings above.

1. **Offer one obvious way per task, and hide the alternatives.**
   - Ship exactly one default tone mapper and one white-balance control.
   - Keep alternative algorithms (filmic, sigmoid, AgX, base curve) behind an "algorithm" dropdown inside a single "Tone" tool, never as sibling modules.
   - Evidence: the top darktable complaint is overlapping modules and tone mappers (FAQ, howto-5.0, HN 5.0 thread, pixls "what's so hard" Sep 2026, One Camera One Lens on filmic/sigmoid, GitHub #14817) (§1.2).
   - 5.2 and 5.4 still added a fourth tone mapper (§1.5).
2. **Lead with a Lightroom-familiar "Basic" panel built from darktable modules.**
   - It should include White Balance (Temp/Tint), Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Texture/Clarity/Dehaze, Vibrance/Saturation.
   - Evidence: GitHub #19084 and #16677 ask literally for this (§1.2).
   - The "Shadows slider" anecdote shows users returning to Lightroom for speed (§1.2).
   - RapidRAW's whole reception rests on a Lightroom CC-like surface (§3.2).
3. **Use progressive disclosure, not a separate "beginner mode".**
   - Each tool should have Basic → Standard → Advanced depth, and the darktable-level controls must stay reachable.
   - Evidence: darktable's "beginner" preset is "not significantly less overwhelming" (§1.2).
   - RawTherapee's Selective Editing Basic/Standard/Advanced modes are a working precedent (§2.1).
   - HN and pixls.us users ask for simple/pro modes (§1.4).
   - Users praise darktable's depth and drift back for it (§1.1).
   - RapidRAW users start asking for parametric masks and more NR control as they mature (§3.4).
   - ART shows the cost of simplifying by *removing* control (§2.4).
4. **Use photographic units and plain-language names, with help that says *when* and *why*.**
   - Show Kelvin, EV and stops, not 0–100. Use task names ("Recover highlights") with the technical module name as secondary text.
   - Evidence: RapidRAW #26 asks for Kelvin and stops (§3.4).
   - darktable slider names "don't make sense unless you're an image science expert" and its terminology is called "academic" (§1.2).
   - Docs explain what, not when or why (§1.1/1.2).
5. **Defaults should look finished on open.**
   - Apply a camera-matched base look (similar in spirit to RawTherapee's Auto-Matched Curve), sensible sharpening and NR, and lens correction automatically.
   - Evidence: darktable "defaults to the minimum processing needed to show a RAW file" (§1.2).
   - Auto-Matched Curve praise (§2.1).
   - darktable only made sigmoid the default for fresh installs in 2025 (§1.5).
6. **Make white balance boring.**
   - One WB control with Temp/Tint and an eyedropper, plus the chromatic-adaptation math underneath. No warnings telling users not to touch it.
   - Evidence: pixls "what's so hard" (Sep 2026), HN Jul 2025, the Galaxus 2026 review and two 2026 pixls threads on WB vs color calibration (§1.2).
7. **Responsiveness is a feature, and the preview must be truthful at every zoom.**
   - Sliders must update in real time.
   - Never hide effects until 100% zoom; if a preview is approximate, show that it is.
   - Evidence: Phoblographer 2025 (an hour on one file), pixls lag threads, the One Camera One Lens "sluggish UI" complaint (§1.3).
   - RawTherapee slowness, NR visible only at 100%, and "sliders do nothing until the tool is enabled" (§2.2/2.3).
   - RapidRAW is praised mainly for speed (§3.1/3.2).
8. **Make masks one-click first, with power second, in one place.**
   - AI subject/sky/person selection plus brush, linear and radial as the default.
   - Parametric (luminance/colour range) refinement as an "Advanced" layer.
   - Every mask listed in one Masks panel, reusable across adjustments.
   - Evidence: darktable masks are powerful but scattered and hard to reuse (§1.1/1.2).
   - The 5.6 AI masks are welcomed (§1.1).
   - RapidRAW's AI masks are its best-received feature (§3.2), and users request parametric masks (§3.4).
9. **Separate "undo history" from "processing pipeline", and make copy/paste visible.**
   - Show a plain undo history and a separate, read-only "what's applied" list.
   - No destructive truncation surprises.
   - Visible Copy, Paste and Paste-selected buttons whose selection list is grouped by tool, not by history order.
   - Never let pasting touch ratings or metadata unless asked.
   - Evidence: darktable history-stack confusion and compress-discards behaviour (§1.2), darktable #22392 (§1.2), RapidRAW's copy wiping star ratings (#26, §3.3).
10. **The Library should have plain folder terms, virtual collections, and no implicit file deletion.**
    - Show a real "Folders" tree mirroring disk, separate from "Collections/Albums" that never move or delete files.
    - Make any disk-level action explicit and undoable.
    - Evidence: digiKam's folder/album terminology confusion and album deletion removing folders (§4.2/4.3).
    - darktable's "filmroll" tedium and file management being the least-liked area in its 2020 survey (43%) (§1.2).
    - darktable #12907 requests a DAM (§1.4).
11. **The Library must be fast from first open.**
    - Show embedded previews immediately, generate thumbnails progressively near the viewport, and cache them persistently.
    - Make startup scans incremental and optional.
    - Evidence: RawTherapee needed 12 min for a 7K-file folder (§2.3).
    - RapidRAW #307, #412, #972, #1448 and #1234 (§3.3).
    - digiKam scan and startup regressions and slow face queries at about 400K images (§4.3).
12. **Sidecars and the catalogue must be predictable and safe.**
    - Document which wins (database or XMP) and detect external XMP changes by default.
    - Write sidecars only on real edits, optionally to a separate folder, and in an interoperable `name.ext.xmp` form for ratings, labels and keywords.
    - Evidence: darktable "lost edits" and out-of-sync database threads (§1.3).
    - darktable/digiKam sync problems with colour labels not syncing (§4.3).
    - RapidRAW #580, #1893 and #459 (§3.3).
13. **Treat Lightroom migration as a feature.**
    - Import Lightroom catalogues or XMP with honest mapping reports.
    - Make search find tools by Lightroom names ("Clarity" → local contrast, "Shadows" → tone tool).
    - Offer a "Where is…?" helper.
    - Evidence: darktable #16677, the 80%-of-work Lightroom import, "tools don't match up exactly" (§1.3); RapidRAW #533 (§3.4).
14. **Build onboarding and discoverability into the app, and keep the UI stable.**
    - A first-run guided edit, contextual tips, right-click menus everywhere, double-click to reset any slider, visible before/after and side-by-side compare, and discoverable shortcuts.
    - Avoid renaming or re-plumbing tools between releases, because external tutorials go stale.
    - Evidence: the first-run guide request (§1.4).
    - Outdated tutorials and churn from filmic to filmic rgb to sigmoid to AgX (§1.2/1.5).
    - No right-click menus and hard shortcut binding (§1.2).
    - RapidRAW #26 (double-click reset, praised in darktable) and #714 (side-by-side) (§3.4).
15. **Stability and data safety outrank features.**
    - Autosave edits continuously, and make crash recovery and library backups automatic.
    - Warn before a library upgrade that is not backward compatible, and keep a rollback copy.
    - Evidence: darktable 5.4.1 macOS crash loops and the "lost all edits on crash" thread (§1.3).
    - darktable library and config being non-backward-compatible across 4.8→5.0 and 5.4→5.6 (§1.3).
    - digiKam DB corruption and tag-loss history (§4.3).
    - RapidRAW crash on cross-OS sidecars (§3.3).
    - "I gave up on darktable … and Linux" (§1.3).

**Caution, not a lesson.** Simplicity alone does not retain serious users. RapidRAW is criticised for image quality, NR, sharpening and (claimed) colour management (§3.3). RawTherapee and darktable users stay for quality and masking depth (§1.1, §2.1). LightBench's advantage is darktable's engine, so the UX must expose it gradually rather than hide or dilute it.

---

## 7. Gaps and limits of this research

- **No page was read in full**, apart from GitHub issue bodies. Professional reviews (PetaPixel, Phoblographer, DCW, Creative Bloq, XDA, LWN) are represented by search excerpts only.
- **Some outlets were not found.** No darktable or RawTherapee reviews surfaced from TechRadar, PCMag, Tom's Guide, Photography Life or It's FOSS (beyond release news). PetaPixel's darktable 5.0 piece is a news write-up, not a hands-on review.
- **Reddit is under-represented.** It was reachable only through a few mirror excerpts, so r/DarkTable, r/photography, r/linux and r/postprocessing sentiment is largely missing.
- **Hacker News comments are partial.** Only snippets were available, for the darktable 5.0.0, Ansel, RapidRAW (Jul 2025) and "Darktable" (Jul 2026) threads.
- **App-store and AlternativeTo-style ratings are thin.** I found a G2 average (4.1/5 from 56 reviews) and a Capterra ease-of-use score (4.0 from 5 reviews) for RawTherapee. No comparable data was found for darktable, digiKam or RapidRAW.
- **GitHub reaction counts are low across the board** (single digits for darktable UI issues), so they say little about how widespread an issue is. The RawTherapee GitHub repo could not be searched.
- **Three RapidRAW questions remain open:** whether it is fully colour-managed, whether it has a catalogue (inferred folder-based), and how accurate its GPU-acceleration claims are. Sources conflict.
- **Some claims in search summaries could not be confirmed and were deliberately left out.** Examples: a "6 to 9 months to master darktable" estimate, and the exact phrasing of an XnView forum quote, which is flagged where used.
- **No independent quantitative usability studies** (task timing, SUS scores) were found for any of these editors.

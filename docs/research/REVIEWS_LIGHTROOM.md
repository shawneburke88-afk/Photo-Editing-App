# Lightroom Classic / Lightroom: what reviewers and users say

Research input for LightBench UX design. Compiled 2026-10-11.

## How this was researched (read first)

- **Method.** Web search only. Direct page fetching was not possible in this environment: WebFetch failed with DNS errors on every domain tried (techradar.com, digitalcameraworld.com, popphoto.com, helpx.adobe.com, photographylife.com, community.adobe.com), the outbound proxy rejected curl to photographylife.com, and reddit.com is blocked for both fetch and search.
- **What the evidence is.** Every finding below comes from search-result titles, URLs and the excerpts the search tool returned. I did not read any page in full. Quotes are short phrases that appeared in those excerpts. Treat them as accurate to the excerpt, and check the page before quoting it publicly.
- **Reddit.** No Reddit threads could be retrieved. User voice comes from the Adobe Community forums, Lightroom Queen forums, DPReview / dprforum, pixls.us and blog comment threads instead.
- **Vote counts.** The Adobe Ideas board does not expose vote totals in search excerpts. **No vote counts are given in this document.** Reply and view counts are given only where an excerpt showed them, and they are labelled as such.
- **Vendor bias.** Several results come from vendors with a stake (Imagen AI, Excire, ON1, Capture One, Skylum). They are flagged where used. Their statistics are not repeated.
- **Prevalence tags.** These are my judgement of how widespread an issue is across independent sources:
  - **[very common]**: raised by several independent reviewers *and* many forum threads.
  - **[recurring]**: appears in several sources.
  - **[one-off]**: a single source or anecdote.

---

## 1. What makes Lightroom approachable and loved

- **Organising plus editing in one app is the core value. [very common]**
  - Digital Camera World (DCW) calls Lightroom Classic "a powerful asset manager that can gather files scattered on multiple external drives into one easy-to-access catalog". It lists asset management, AI masking, AI Denoise and broad RAW support as pros. https://www.digitalcameraworld.com/reviews/adobe-lightroom-classic-review (undated in excerpt)
  - Life After Photoshop calls Classic "the professional cataloguing and editing tool by which all others are judged". It says the Library/cataloguing features "are among the best on the market". https://lifeafterphotoshop.com/lightroom-classic-review/ (2023)
  - PCMag, via a syndicated copy, keeps Classic as "our Editors' Choice winner for pros, thanks to its local printing, plug-in, and tethering support". https://tech.yahoo.com/general/articles/adobe-lightroom-190000921.html (©2025)
- **The Basic panel is the on-ramp. [recurring]**
  - Tutorial sources describe the panel as "brilliantly simple" with "deceptively easy-to-use" sliders. They say it is often "the only panel you will need" for a well-exposed photo. https://cdn.shutterbug.com/node/590709, https://digital-photography-school.com/?p=150575
  - A counter-view from Digital Photography School: Lightroom as a whole "is anything but intuitive for new photographers… multitude of panels, sliders, menus, and buttons".
  - Caveat: the praise comes mostly from tutorial sites, not independent usability studies.
- **The cloud Lightroom is seen as the friendlier one. [recurring]**
  - PCMag praises "class-leading editing and organizing tools in a modern interface, along with seamless cloud syncing". https://tech.yahoo.com/general/articles/adobe-lightroom-190000921.html (©2025)
  - Life After Photoshop lists a "simplified, streamlined interface" as a pro. https://lifeafterphotoshop.com/adobe-lightroom-review-2025/ (2025)
  - Tom's Guide (Editor's Choice) lists "interactive tutorials" and autotagging as pros. https://www.tomsguide.com/reviews/adobe-lightroom
- **The keyboard-driven culling loop is loved by power users. [recurring]**
  - Fstoppers shows P (pick), X (reject) and U (unflag), plus Caps Lock auto-advance, so you can "move quickly through a big shoot without touching the mouse". It also covers Survey (N) and Compare (C). https://fstoppers.com/lightroom/keyboard-shortcuts-actually-speed-lightroom-classic-718346
- **Sync Settings and Copy/Paste make batch edits fast. [recurring]**
  - Adobe documents copy/paste with selectable subsets of settings and batch application. https://helpx.adobe.com/lightroom-classic/help/copy-paste-settings.html
  - Tutorials call Sync (Ctrl/Cmd+Shift+S) "quicker" than copy/paste. They warn that local adjustments and spot removal are the settings most likely to misbehave when copied. https://thelenslounge.com/how-to-copy-settings-in-lightroom-classic/
- **Presets, now including adaptive (AI-masked) presets, give speed and a consistent look. [recurring]**
  - Guides cite speed on large batches and a uniform look across a set.
  - Sceptics note that a static preset "reacts badly" to different light, so it is a starting point, not a finish. https://www.lenscraft.co.uk/what-are-lightroom-presets/, https://cdn.shutterbug.com/node/592449
- **Smart Collections are rule-based saved searches across the whole catalogue. [recurring]**
  - Adobe documents rules on any IPTC/EXIF field, keywords and XMP sync status. https://helpx.adobe.com/ee/lightroom-classic/help/smart-collections-criteria-in-lightroom-classic.html
  - Users note "the search is only as good as the data you add". https://www.tipsquirrel.com/lightroom-organization-with-smart-collections/
  - Keyword upkeep is called "hard to maintain". https://bcgforums.com/threads/how-do-you-organize-your-collections-in-lightroom-classic.40376
- **AI masking (October 2021) is a major win. [very common, but see the masking UI complaints in section 2]**
  - Adobe added Select Subject and Select Sky in the new Masking panel (Classic 11.0, October 2021). https://helpx.adobe.com/lightroom-classic/help/whats-new/2022.html
  - Reviewers now list "AI-assisted masking" as a headline pro (DCW above). Comparisons say Lightroom's "faster AI masking" suits high-volume work. https://www.digitalcameraworld.com/au/buying-guides/best-lightroom-alternatives
- **AI Denoise (April 2023) is one of the most praised additions. [very common]**
  - Amateur Photographer found it beats the old manual NR. It notes that previously "many photographers paid for third-party software". https://amateurphotographer.com/software/adobe-lightrooms-denoise-tool-how-does-it-compare
  - Unique Photo calls it "one of the best native noise-reduction tools Adobe has offered", while noting it is not needed on every file. https://www.uniquephoto.com/photoinsider/is-the-new-lightroom-ai-denoise-worth-it-real-world-results-and-workflow-recommendations
- **Assisted Culling (Classic 15.0, MAX October 2025; out of early access June 2026) is well received. [recurring]**
  - TechRadar calls it "actually a great time saver". https://www.techradar.com/pro/software-services/adobe-lightroom-classic-2026-review (2026)
  - Adobe says it is tuned for people photography. Rejects are kept, not deleted, and every Select/Reject can be overridden. https://community.adobe.com/questions-675/p-assisted-culling-feedback-thread-lrc-1627467 (June 2026 post)
  - Fstoppers covers it alongside Dust Removal and shadow-aware removal. https://fstoppers.com/lightroom/lightroom-classic-150-update-finally-speeds-your-workflow-716702
  - Evidence is thin: no neutral hands-on accuracy test was found.
- **The import dialog is powerful (Add / Copy / Move / Copy as DNG, apply a preset and metadata on import).** It is loved by experienced users but is also a top source of confusion (see section 2).
  - When Adobe "simplified" it in Lightroom 6.2 (October 2015), the change removed features such as Move and auto card-eject. The backlash was large enough that product manager Tom Hogarty apologised, and Adobe announced on 16 Oct 2015 that it would restore the old import workflow. https://petapixel.com/2015/10/10/adobe-apologizes-for-latest-lightroom-6-2-update/, https://thenextweb.com/news/adobe-will-restore-the-old-lightroom-import-dialog (Oct 2015) **[very common at the time]**
  - Lesson: simplify by layering, not by removing.

## 2. Usability complaints

- **Catalogue vs. files is the most common conceptual stumbling block. [very common]**
  - Adobe's own help says that moving or renaming files in Finder/Explorer "breaks the link". https://helpx.adobe.com/lightroom/help/locate-missing-photos.html
  - Forum answers repeatedly have to explain that the catalogue "is a database… [that] keeps track of where the images are located". They also explain that folders don't show unless the catalogue holds a photo from them. https://community.adobe.com/t5/lightroom-classic-discussions/can-t-see-the-photos-in-lr/m-p/11719813
  - Users see "?" / greyed folders when a drive is unplugged or a drive letter changes. Experts warn that "Synchronize Folder never fixes the problem… but it can certainly make it worse". https://community.adobe.com/t5/lightroom-classic-discussions/os-c-missing-from-folders-in-lightroom-classic-2024-only-question-marks-appear/td-p/15052585 (2024), https://www.lightroomqueen.com/community/threads/file-offline-missing-error.7411/
  - Some "lost" photos are really sitting in the wrong catalogue, or were imported with Copy instead of Add into an unexpected folder. https://community.adobe.com/questions-675/missing-folders-955779
- **The import dialog confuses new users. [recurring]**
  - One instructor: "New users are frequently confused by the Lr Classic import screen."
  - The destination is "easy to overlook".
  - Copy and Move appear greyed out when importing from a card, which also confuses people. https://photofocus.com/software/understanding-lightroom-classics-import-dialog/, https://community.adobe.com/t5/lightroom-classic-discussions/copy-as-dng-copy-and-move-greyed-out-in-library-module/td-p/13821329
  - There is an Ideas post asking to relabel the Source panel "Import from". https://community.adobe.com/feature-requests-676/p-at-the-top-of-the-source-panel-change-the-label-to-import-from-666105
- **Import is mandatory, and there is no live folder view. [recurring]**
  - "You have to import files before you can view them." https://improvephotography.com/52441/an-adobe-lightroom-alternative-for-photographers-on1-photo-raw-review/
  - Synchronize Folder is manual, and auto-import watches only one folder. Users report sync dialogs stuck on large folders and duplicates silently skipped. https://community.adobe.com/questions-675/best-way-to-synchronize-new-folders-from-external-drive-940306, https://www.lightroomqueen.com/community/threads/synchronize-folder-sometimes-unusable.46459/
  - For quick culls, forum experts tell users to use Bridge instead, because Classic needs an import first. https://community.adobe.com/t5/lightroom-classic-discussions/i-need-an-app-to-quickly-go-through-photos/m-p/11836446
- **Performance and lag are the most-cited complaint in reviews and forums. [very common]**
  - DCW cons: "A bit sluggish at drawing up thumbnails in large catalogs." https://www.digitalcameraworld.com/reviews/adobe-lightroom-classic-review
  - Life After Photoshop cons: slow on low/mid-range machines. https://lifeafterphotoshop.com/lightroom-classic-review/
  - Pop Photo: it "can still tax even the most powerful editing computers". https://www.popphoto.com/reviews/adobe-lightroom-classic-review/
  - Forum threads from 2024–2026:
    - Slow Develop photo-to-photo switching on a new high-spec PC. https://community.adobe.com/t5/lightroom-classic-discussions/navigating-photos-in-develop-module-is-slow/td-p/15633291 (Dec 2025)
    - "Program is now extremely slow" after v15.0. https://community.adobe.com/t5/lightroom-classic-discussions/updated-to-lr-classic-v15-0-and-program-is-now-extremely-slow/td-p/15569367/page/2 (Nov 2025)
    - Develop responsiveness "progressively deteriorates during extended … sessions". https://community.adobe.com/bug-reports-674/lightroom-classic-15-5-1-technical-performance-report-1644232 (Sep 2026, single user) **[one-off]**
  - Puget Systems measured a v15.0 Windows regression (smart previews and DNG export). They say it was largely fixed in 15.2. https://www.pugetsystems.com/blog/category/software/lightroom-classic/
  - Regressions after updates are a recurring theme. In threads after 15.0, one user said the only workaround was to "downgrade to version 14.5.2"; others said 15.0.1 was much better. https://community.adobe.com/t5/lightroom-classic-discussions/lightroom-classic-v15-0-amp-later-slow-in-develop-and-library-module-operations/m-p/15575633, https://community.adobe.com/t5/lightroom-classic-discussions/updated-to-lr-classic-v15-0-and-program-is-now-extremely-slow/m-p/15586787 (Oct–Nov 2025; the search excerpt did not say which of these threads holds the quote)
- **Classic vs. cloud naming confusion. [recurring]**
  - The June 2024 Ideas post "P: Change app names" says the names make it hard to ask for help ("very confusing when trying to clarify which version"). Some users read "Classic" as a sign of coming discontinuation. A community manager merged it into another idea in Feb 2026. https://community.adobe.com/t5/lightroom-classic-ideas/p-change-app-names/idi-p/14660217
  - There is an older thread titled "Why did you name it the same bloody thing". https://community.adobe.com/t5/lightroom/why-did-you-name-it-the-same-bloody-thing/m-p/9636731
  - Many "which one should I use" explainers exist (DCW, Digital Photography School, SlashGear), which itself suggests confusion. https://www.digitalcameraworld.com/buying-guides/lightroom-vs-lightroom-classic
- **The Develop panel is long, with lots of scrolling. [recurring]**
  - Users wish for "multiple columns for the develop panel so I don't spend so much time scrolling". Another user says they are "always in Solo mode because I hate the yo-yo-scrolling". https://lightroomkillertips.com/customize-develop-panel/
  - Adobe added panel reordering/hiding and documents Solo mode. https://helpx.adobe.com/lightroom-classic/help/workspace-basics.html
  - Downside of reordering: it breaks "habitual muscle memory".
- **Masking UI churn (Classic 11, October 2021). [recurring]**
  - Users complained that radial and gradient tools moved into a new menu, "creating extra steps". https://community.adobe.com/t5/lightroom-classic-discussions/changes-on-user-interface-for-local-adjustment-tools/m-p/12493293/page/2
  - Add/Subtract controls were hard to find. https://community.adobe.com/t5/lightroom-classic-discussions/part-of-the-new-quot-masking-quot-interface-is-missing/m-p/12478477
  - The floating Masks panel auto-hides on mouse-down; the workaround is to disable "Auto Hide Masking Panel". https://jkost.com/blog/?p=21346
  - The panel sometimes doesn't appear in v11/v12. https://community.adobe.com/t5/lightroom-classic-discussions/mask-panel-missing-in-lrc-11-amp-12/m-p/13283021 (Oct 2022)
  - The redesigned luminance range mask "only feathers out", which some find worse than before. https://community.adobe.com/feature-requests-681/p-add-luminance-range-masking-661164
- **The History panel is linear only. [recurring, low intensity]**
  - You cannot toggle off one middle step. The only per-step action is "Clear History Above this Step". Users have asked about this for years in comments. https://lightroomkillertips.com/history-panel-tips/, https://jkost.com/blog/2024/08/the-history-panel-and-before-after-view-in-lightroom-classic.html
  - No formal Ideas thread with visible traction was found. **Evidence thin.**
- **Export presets.**
  - Multi-preset batch export (Classic 9.0, Nov 2019) exists, but checking presets disables all dialog settings and hides post-processing and plug-in sections. The visible settings "may not reflect the settings contained in the checked presets". https://helpx.adobe.com/lightroom-classic/help/whats-new/2020.html, https://scottwyden.com/export-multiple-presets-lightroom/ **[one-off as a complaint; documented behaviour]**
- **Auto quality is inconsistent (detail in section 6). [recurring]**
- **Cloud Lightroom gaps.**
  - Tom's Guide cons: you "can't rename a photo or an edited version", and there is no side-by-side zoomable comparison. https://www.tomsguide.com/reviews/adobe-lightroom **[one-off]**
  - Its Local tab (Oct 2023) has "no albums or proper search" and no Versions for local folders. https://lifeafterphotoshop.com/lightroom-adds-local-storage-but-is-this-quite-the-game-changer-it-seems/ **[recurring]**

## 3. Pitfalls and dealbreakers

- **Subscription-only pricing. [very common, the single most common con]**
  - Subscription-only is listed as a con by DCW (Classic), TechRadar (2024 and 2026), Life After Photoshop and others.
  - Jan 2025 changes: the 20GB Photography plan closed to new subscribers on 15 Jan 2025 and its monthly price rose from $9.99 to $14.99. The Lightroom 1TB plan rose $2 and now includes Classic. https://helpx.adobe.com/creative-cloud/faq/ccpp-20gb.html, https://petapixel.com/2024/12/17/adobe-to-increase-the-prices-of-some-photography-plans-next-month, https://blog.adobe.com/en/publish/2024/12/15/all-new-photography-innovations-pricing-updates (15 Dec 2024)
  - Users object to paying for 1TB of storage they don't need. https://community.adobe.com/t5/photoshop-ecosystem-discussions/price-increase/m-p/15114109
  - DCW on cloud Lightroom: the "1TB storage requirement built into current subscription plans" is its main drawback. https://www.digitalcameraworld.com/reviews/adobe-lightroom-cc-review
  - Switching articles from 2025–2026 cite cost and lock-in:
    - Fstoppers, "The Real Reason Photographers Are Leaving Adobe": https://fstoppers.com/software/real-reason-photographers-are-leaving-adobe-901527
    - Phoblographer (Feb 2026): https://thephoblographer.com/2026/02/20/photographers-leaving-adobe-behind/
    - MakeUseOf (Dec 2025), moved to darktable: https://www.makeuseof.com/photo-editing-app-so-good-stopped-using-lightroom/
    - Savannah Software: https://savannahsoftware.com/blog/leavinglightroom/
  - A counter-example: a 2025 Phoblographer writer returned to Lightroom after nearly a decade. https://www.thephoblographer.com/2025/04/17/i-gave-up-lightroom-for-nearly-a-decade-now-im-coming-back/
- **Catalogue corruption and loss. [recurring]**
  - The catalogue is a single file. Users report "catalog cannot be opened due to a data problem". Experts point to cloud-synced folders: "having your LrC catalog under OneDrive is a very common cause of corrupt catalogs". https://community.adobe.com/questions-675/corrupt-lightroom-classic-catalog-need-help-repairing-1639431 (Aug 2026)
  - Backups are ZIPs that must be extracted, and AI masks live in a separate `.lrcat-data` file that must be restored too. https://lightroomkillertips.com/recovering-from-catalog-loss-or-corruption/
  - Classic 14.2 (Feb 2025) added backup management in Catalog Settings. https://helpx.adobe.com/lightroom-classic/desktop/help/whats-new/2025-2.html
- **Large catalogues degrade. [recurring]**
  - A 540k-image catalogue reached "unusable levels" despite high-end hardware. https://community.adobe.com/t5/lightroom-classic-bugs/p-performance-slow-on-large-catalog-540k-images-crash-9690382/idi-p/14868732/page/2 (Sep 2024)
  - Typical advice is to optimise the catalogue, raise the default 5GB ACR cache, use Smart Previews, and turn off auto-write XMP. https://imagen-ai.com/post/why-lightroom-classic-slow-fix/ (vendor)
  - One user reports a catalogue data file of about 85 GB. https://community.adobe.com/bug-reports-674/lightroom-classic-15-5-1-technical-performance-report-1644232 **[one-off]**
- **Cloud dependence for AI features. [recurring]**
  - Generative Remove needs "stable internet connection" and is Firefly-powered. Unticking "generative AI" falls back to local Content-Aware Remove. https://community.adobe.com/t5/lightroom-classic-discussions/p-new-ai-powered-generative-remove-early-access-available-across-all-surfaces/m-p/14633900/highlight/true (2024)
  - Generative credit rules confused users. https://www.lightroomqueen.com/community/threads/why-is-adobe-becoming-a-customer-fleecing-organization.54513/
  - TechRadar 2026 cons: "AI can be hit and miss; Generative Credits can be expensive". https://www.techradar.com/pro/software-services/adobe-lightroom-classic-2026-review
  - TechRadar 2024 calls cloud Lightroom "Soaked in AI". https://www.techradar.com/pro/software-services/adobe-lightroom-2024-review
- **Generative AI and Terms of Use distrust (June 2024). [very common at the time]**
  - A forced re-acceptance pop-up included wording that Adobe could access content "by automated and manual means". Users read it as AI training on their work. Adobe called the wording "unclear" and revised the terms, stating it does not train generative AI on customer content (except Adobe Stock submissions) and does not scan locally stored content. https://www.cgchannel.com/2024/06/adobe-updates-its-terms-of-use-following-artist-backlash (20 Jun 2024), https://alternativeto.net/news/2024/6/adobe-responds-to-tos-controversy-and-reassures-users-it-won-t-train-ai-on-their-work/
  - Commentary notes the distrust lingered. https://iamawatchman.substack.com/p/part-3-best-practices-on-ai-adobe
- **Tethering reliability. [recurring]**
  - Reports include camera detection failures, disconnects and crashes, for example Classic 10.0 not detecting a Nikon Z7 while Capture One did. https://community.adobe.com/t5/lightroom-classic-discussions/trouble-tethering-lightroom-classic-ver-10-0-with-nikon-z7/m-p/11613224 (2020)
  - Fujifilm tethering is unreliable in both Lightroom and Capture One. https://www.jmpeltier.com/fujifilm-tethering-workarounds-lightroom-capture-one/
- **No Linux version. [recurring among a niche]**
  - "P: Provide support for Linux" dates from Dec 2010. One copy is tagged "Idea Declined" and shows about 433 comments (comments, not votes). https://community.adobe.com/t5/lightroom-classic-ideas/p-provide-support-for-linux/m-p/3107921
  - This is relevant to LightBench as a web-first, cross-platform product.

## 4. Most-requested features (Adobe Ideas board and wish lists)

**Vote counts were not visible in any search result, so none are given.** The items below are long-running "Open for Voting" ideas or recurring wish-list items. Reply and view counts appear only where an excerpt showed them.

- **Layers / stacked adjustments.** "P: Add Layers to Lightroom" dates from 23 Aug 2011 and is still "Open for Voting". Excerpts showed about 97 replies and about 11.7–11.9k views. Later replies (Oct 2024) shift to mask grouping and sub-mask opacity. https://community.adobe.com/feature-requests-676/p-add-layers-to-lightroom-666312 **[recurring]**
  - A related idea, "Open as layers in Photoshop", was marked Released (Dec 2024). https://community.adobe.com/feature-requests-681/p-ability-to-open-as-layers-in-photoshop-661127
- **Masking refinements.** Requests include feathering a mask universally and separating AI mask outlines from effect settings. https://community.adobe.com/feature-requests-676/index14.html **[recurring]**
- **Browse multiple catalogues in one view.** "P: Add a master catalog view for browsing multiple catalogs" is a recent post. Adobe's FAQ says multiple catalogues are "not recommended". https://community.adobe.com/feature-requests-676/p-add-a-master-catalog-view-for-browsing-multiple-catalogs-1626544, https://helpx.adobe.com/lightroom-classic/kb/catalog-faq-lightroom.html **[recurring]**
- **Automatic folder sync (watch the folder tree for new files).** This is asked often in Q&A threads, but no single Ideas thread was found. https://community.adobe.com/t5/lightroom-classic-discussions/can-lightroom-synchronize-the-folder-automatically-without-my-having-to-do-it-manually-for-each-jpeg/m-p/10027501 **[recurring]**
- **HEIC/HEIF export.** "Open for Voting" since 18 Aug 2018, with about 70 replies. Classic 13+ already supports AVIF/JPEG XL when HDR output is enabled. https://community.adobe.com/feature-requests-564/p-ability-to-export-files-in-the-heic-heif-formats-666659/index2.html **[recurring]**
- **Rename the apps.** See section 2. https://community.adobe.com/t5/lightroom-classic-ideas/p-change-app-names/idi-p/14660217
- **Linux support.** Declined. See section 3.
- **Wish lists from prominent educators and readers:**
  - A Photoshop-grade healing brush.
  - A slideshow overhaul.
  - A more neutral default raw rendering.
  - The author says none of his 2018 wishes had been delivered.
  - Sources: https://lightroomkillertips.com/none-of-the-features-from-my-2018-wish-list-have-made-it-to-lightroom-classic/
  - Fstoppers readers asked for content-based search "like google photos" and for Versions in the cloud app's Local tab. https://fstoppers.com/originals/7-lightroom-features-i-wish-existed-492397 **[one-off each]**
- **Culling.** Adobe itself said its 2025 priority was "top requests from the photography community, like culling, editing and sharing". It then shipped Assisted Culling. https://blog.adobe.com/en/publish/2024/12/15/all-new-photography-innovations-pricing-updates

## 5. What competitors do better (per reviewers)

- **Capture One: layers, sessions and tethering. [very common]**
  - Layer-based adjustments: "Capture One employs a layering system for adjustments, however, Lightroom does not."
  - Sessions let you "browse and edit images without importing them", with Lightroom-style catalogues still available. https://lifeafterphotoshop.com/capture-one-vs-lightroom/, https://www.format.com/magazine/capture-one-vs-lightroom
  - Tethering: "Those who shoot tethered generally prefer Capture One." Another user calls it "the king of tethering". https://www.slrlounge.com/capture-one-vs-lightroom-tethered-shooting/
  - The interface "can be fully customised". https://www.galaxus.de/en/page/capture-one-gute-lightroom-alternative-ohne-abozwang-42157
  - DCW lists "adjustment layers and masks" as pros, and says it is more expensive, though a perpetual licence exists. https://digitalcameraworld.com/reviews/capture-one-pro-23-review
  - Switchers mention Fuji X-Trans rendering, sessions fitting their workflow, and a "Migration" workspace that mimics Lightroom's layout to ease switching. https://photographylife.com/switching-from-lightroom-to-capture-one-pro, https://fujivsfuji.com/fuji-views/switching-to-capture-one (some sources are Capture One's own blog)
  - Where Lightroom wins: AI Denoise, plug-in ecosystem, faster AI masking for volume work, and price. https://www.digitalcameraworld.com/au/buying-guides/best-lightroom-alternatives
- **DxO PhotoLab: denoise quality, but a weak library. [recurring]**
  - DCW calls DeepPRIME XD2s its strongest point. Lightroom is "quicker and easier" but doesn't match PhotoLab on raw quality. https://www.digitalcameraworld.com/reviews/dxo-photolab-8-review
  - Amateur Photographer finds DeepPRIME "more consistent" than Adobe Denoise, with some halo and over-smoothing risk mitigated by extra controls. https://amateurphotographer.com/?p=231149
  - Downsides: the library is weaker than Lightroom's (no Smart Albums, simpler search). https://lifeafterphotoshop.com/dxo-photolab-vs-lightroom-classic-is-photolab-a-viable-alternative-for-cataloguing/
  - Some find it "overly technical to new users". https://europeanpurpose.com/tool/dxo-photolab
  - Its live folder view, which reflects changes made elsewhere, is a plus. https://havecamerawilltravel.com/photographer/lightroom-alternatives/
- **ON1 Photo RAW: browse without import. [recurring]**
  - "Navigate directly to folders… and begin working with them immediately", with cataloguing optional. https://www.on1.com/blog/browse-vs-cataloged-workflows-in-on1-photo-raw/ (vendor), https://improvephotography.com/52441/an-adobe-lightroom-alternative-for-photographers-on1-photo-raw-review/
  - Trade-off: offline drives can't be viewed, while Lightroom's previews still work offline. Photography Life notes ON1's database can't be backed up from inside the app. https://photographylife.com/lightroom-vs-on1
- **Luminar Neo: one-click AI and simplicity, but weak DAM and speed. [recurring]**
  - AI tools such as sky replacement "in seconds".
  - "Far simpler image referencing interface, much like a regular file browser."
  - But it "does not do what Lightroom Classic does for a proper catalog", and scrolling lags on folders of hundreds of RAWs. https://www.culturedkiwi.com/luminar-review/ (2026), https://shotkit.com/luminar-neo-lightroom-compared/
  - TechRadar: good for those "intimidated by Lightroom or Photoshop", but automated features are "hit and miss". https://www.techradar.com/reviews/luminar-neo
- **darktable, which is LightBench's engine. [recurring]**
  - darktable's own FAQ concedes "the initial learning curve can be steep" and says it is "not a direct replacement". https://www.darktable.org/about/faq/
  - Reviewers call its interface "cluttered and confusing to a first time user" and note slider lag. https://havecamerawilltravel.com/darktable-raw-image-processing/
  - Forum users praise its depth once learned. https://discuss.pixls.us/t/making-the-switch-from-lightroom-to-darktable/38489
  - **This is exactly the gap LightBench is aiming at.**

## 6. How Lightroom's Auto works, and how users rate it

- **What Adobe says.**
  - Launched 12 Dec 2017 across Lightroom CC, mobile, web, Classic (7.1) and ACR.
  - It is a neural network "powered by Adobe Sensei" that analyses the photo and compares it with "tens of thousands" of professionally edited photos. Some secondary sources say "thousands".
  - Sources: https://techcrunch.com/2017/12/12/adobe-lightrooms-auto-setting-is-now-powered-by-ai/, https://www.engadget.com/2017-12-12-adobe-lightroom-uses-ai-for-photo-edits.html, https://9to5mac.com/2017/12/12/lightroom-cc-auto-settings-adobe-sensei/, https://terrywhite.com/new-updates-lightroom-december-2017/
  - No architecture details are public.
- **What it touches.**
  - Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Vibrance and Saturation. It was renamed from "Auto Tone" to "Auto" around 7.2 because it changes colour too. https://helpx.adobe.com/ie/lightroom/mobile/adjust-light-and-color/apply-auto-settings.html, https://lightroomkillertips.com/new-lightroom-updates-today-one-new-features-pretty-awesome/
  - Shift-double-clicking a slider label auto-sets that single slider. This is documented in forums, not in the help excerpt seen. https://community.adobe.com/questions-675/shift-double-click-behavior-on-basic-panel-sliders-966202
  - An Adobe community staffer says the result is deterministic: it does not learn from the user. https://community.adobe.com/t5/lightroom-classic-discussions/tone-quot-auto-quot-button-consistently-gives-severely-underexposed-pictures/m-p/9592376
- **How users rate it: a starting point, not a finish. [recurring]**
  - Scott Kelby nicknames it "The Over-exposure Button". He says it tends to open shadows too much and lower contrast (an "HDR-like" look). https://lightroomkillertips.com/make-lightrooms-improved-auto-button-even-better/
  - Other users report the opposite, with severe under-exposure. https://community.adobe.com/t5/lightroom-classic-discussions/tone-quot-auto-quot-button-consistently-gives-severely-underexposed-pictures/m-p/9592376
  - Night shots come out "overexposed and unnatural". https://community.adobe.com/t5/lightroom-ecosystem-cloud-based-discussions/auto-tone-results-in-overexposed-photos/m-p/11595586
  - A bug report says batch Auto gives different results than applying Auto to each photo individually. https://community.adobe.com/bug-reports-674/p-auto-tone-of-a-batch-of-photos-gives-different-results-than-if-you-do-them-one-at-a-time-663629 **[one-off]**
  - Most of this evidence dates from 2017–2020. No systematic recent test was found.
- **Adaptive Profiles (Classic 14.2, Feb 2025, RAW only) are an alternative "auto" approach.**
  - They do AI work inside the profile and leave sliders at zero. One reviewer says this gives "much more editing leeway" and "a much better result than Auto". Adobe advises not combining Adaptive with Auto ("unpredictable results").
  - Users are split on daily use.
  - Sources: https://lifeafterphotoshop.com/lightroom-tip-lightrooms-new-adaptive-color-profile-is-much-better-than-it-sounds, https://gregbenzphotography.com/lightroom-acr/acr-17-ai-adobe-adaptive-profiles-non-destructive-denoise-generative-expand, https://www.l-camera-forum.com/topic/423705-adobe-adaptive-profiles-experience **[recurring, small sample]**

---

## Synthesis: top 15 lessons for LightBench

**Copy**

1. **Keep the mental model: Import → Library → Develop → Export, with a Basic panel first.** Reviewers and educators consistently cite the Basic panel as the on-ramp and the integrated library-plus-editor as Lightroom's core value. Present Basic as the default, collapsed-to-essentials view, with darktable's depth one click away.
2. **Make the keyboard culling loop first-class: P / X / U, 0–5 stars, Caps-Lock-style auto-advance, Survey and Compare.** It is the most praised power-user feature and costs little on the web.
3. **Provide Sync / Copy-Paste with selectable subsets, plus presets.** Batch consistency is a core reason people use Lightroom. Warn when local masks or spot removal are included in a sync, since these misbehave when copied.
4. **Ship rule-based Smart Collections and keyword tools early,** but cut the tagging burden. "The search is only as good as the data you add" suggests auto-tagging and content search, a frequent wish.
5. **Offer Auto as a transparent, editable starting point.** Lightroom's Auto is liked as a starting point and distrusted as a finish: too bright for some, too dark for others, and HDR-ish. LightBench's Auto should set *visible* slider values, be deterministic, and work identically in batch and single mode. Consider an "adaptive" variant that leaves sliders at zero, which reviewers preferred.

**Avoid**

6. **Never make "where are my photos?" a question.** Catalogue-vs-files confusion, "?" folders and wrong-catalogue mistakes are the most common user problem. Use one library per user, show file location and online/offline state plainly, detect moved or renamed files automatically (hash-based relinking), and never let a "sync" action delete records silently.
7. **Don't force import before viewing.** ON1, Capture One sessions and DxO's live folders are praised for browse-first. Let users open a folder and cull immediately, then "add to library" without copying. Watch folders for new files, a long-standing ask.
8. **Don't simplify by removing.** Lightroom 6.2's stripped-down import (2015) caused a public apology and a rollback. The 2021 masking redesign moved tools behind extra clicks and auto-hid panels. Use progressive disclosure (simple by default, advanced on expand) and keep shortcuts and muscle memory stable across releases.
9. **Avoid confusing product naming and splits.** "Lightroom" vs "Lightroom Classic" is a recurring complaint. The web and desktop LightBench should be one product with one name and the same edit model, described as "where it runs", not as two apps.
10. **Avoid a single fragile catalogue file and cloud-sync corruption.** Use a transactional store, automatic versioned backups that restore in one click (no ZIP extraction or side-car files to remember), and write XMP/sidecars so edits survive DB loss. Warn when the library sits in OneDrive or Dropbox.
11. **Don't hide core features behind subscriptions, credits or the cloud.** Subscription is the number-one dealbreaker, and the 2024 Terms-of-Use backlash shows deep sensitivity about AI and content access. Since LightBench is free, say so loudly. Keep processing local or in-browser by default, and publish a plain-language "we never upload or train on your photos" policy.

**Do better**

12. **Treat performance as a feature and measure it.** Lag in Develop, thumbnail generation and big catalogues is the most frequent review con, and Lightroom often regresses between versions. Set budgets (photo-to-photo switch time, slider latency, thumbnail throughput at 100k+ images) and add regression benchmarks to CI. Use progressive previews so the UI never blocks.
13. **Fix the long Develop panel.** Offer solo mode by default or an accordion, plus search-a-tool (command palette), optional two-column layout on wide screens, and pinned favourites, without reordering defaults under people's feet.
14. **Make history and masking more powerful than Lightroom.** Allow toggling individual history steps or adjustments (darktable's pixelpipe history already supports this), and offer a layer-like mask stack with grouping, opacity and feather. Layers are the oldest open request (since 2011) and the top Capture One advantage cited by reviewers.
15. **Make export presets transparent, and put quality AI where it counts.** Show exactly what each checked export preset will produce in multi-export, and support modern formats (HEIC/AVIF/JPEG XL). For AI, prioritise denoise quality (DxO-level is the benchmark), reliable subject/sky masks, and assisted culling with overridable, non-destructive decisions. Label any feature that needs a network.

---

## Gaps and weak spots in this research

- **No full-page reads.** WebFetch and direct HTTP were blocked, so all content is from search excerpts. Verify key quotes before external use.
- **No Reddit data.** r/Lightroom, r/photography and r/AskPhotography could not be searched or fetched. Forum evidence leans on Adobe Community and Lightroom Queen, which skews toward troubleshooting.
- **No vote counts** from the Adobe Ideas board, so the most-voted ranking is unknown. Re-check by sorting the board by votes in a browser: https://community.adobe.com/t5/lightroom-classic-ideas/idb-p/idea-lightroom-classic
- **Missing professional reviews:** PetaPixel's and DPReview's own Lightroom Classic reviews, PCMag's Classic review (only a syndicated cloud review was seen), and Photography Life's main review were not found.
- **Auto evidence is old** (mostly 2017–2020), and no controlled test of Auto quality was found.
- **The Assisted Culling and Adaptive Profile ratings** rest on few, partly vendor, sources.

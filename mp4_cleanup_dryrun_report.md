# Vercel Blob MP4 Cleanup Dry-Run Report

**Date**: 2026-06-20T16:26:22.332Z
**Total Blob Storage**: 1021.53 MB
**Total MP4 Storage**: 963.16 MB (36 files)

### Summary
* **Orphan MP4 Candidates (Safe to delete)**: 0 files (0.00 MB)
* **Referenced MP4 Candidates (Needs DB updates before deleting)**: 36 files (963.16 MB)
* **Other Tenant MP4s (Excluded for isolation)**: 0 files (0.00 MB)

### 1. Orphan MP4 Candidates (Safe to Delete)

No orphan MP4 candidates found.

### 2. Referenced MP4 Candidates (Requires DB updates)

| # | Pathname | Size (MB) | DB References |
|---|----------|-----------|---------------|
| 1 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMjI3OTIxODQ3NTIVAgASGCBBQ0U4NDRFRUZEMDUwODk2NDc4N0EwOEM1MTMyOTA2NwA=_video_wamid.HB.mp4` | 3.63 | messages.media_url (ID: a2344648-d407-4334-85da-6063742eb7b1) |
| 2 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMjI3OTIxODQ3NTIVAgASGCBBQzFCNjBFRDE5REVDRDQ3NTg1RjNGNTI4RUYyNTI4NwA=_video_wamid.HB.mp4` | 8.78 | messages.media_url (ID: 1513424b-266a-4d61-be2b-85d94a7287c3) |
| 3 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMjI3OTIxODQ3NTIVAgASGCBBQzM0NjAxQjIyODY3N0U1NTM5NDI1NTkxRDg0Mjg4MwA=_video_wamid.HB.mp4` | 2.63 | messages.media_url (ID: 50fc5823-4e5c-4c7c-b6e9-c5fbf14f7d5b) |
| 4 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMjI3OTIxODQ3NTIVAgASGCBBQzMyQUI1ODVCNTY0MjRFRDhENkU4RDFFMDc4MDI5OQA=_video_wamid.HB.mp4` | 2.60 | messages.media_url (ID: f8e1e35e-1796-439a-acb5-5870de5a3a94) |
| 5 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMzM2MDE3Nzk0ODgVAgARGBQ0QURBMTdEN0MzQUUyQjVDOUE1MAA=_video_wamid.HB.mp4` | 11.84 | messages.media_url (ID: 201f16ee-298b-47d6-92eb-85451befd55e) |
| 6 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMzM2MDE3Nzk0ODgVAgARGBQyQTlGNTVDRTIyNTRDNzE5NTQ4NgA=_video_wamid.HB.mp4` | 10.46 | messages.media_url (ID: e698254d-f53f-4135-a756-5ca161baa768) |
| 7 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMzM2MDE3Nzk0ODgVAgARGBQyQUFDMDc5NjU3ODNGRjE1MjY1MAA=_video_wamid.HB.mp4` | 9.13 | messages.media_url (ID: 25981d6e-e03d-447c-88f5-e27c347c7ee6) |
| 8 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIyMzEzMzMxFQIAEhggQTU3NkI4N0RCMzU0NzcxRTQ1NUY1NERGMjE3RDEwQUYA_video_wamid.HB.mp4` | 5.81 | messages.media_url (ID: 18dd9ae6-07c9-4bc4-86ea-1c5f7ace8887) |
| 9 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIzMzMyNDcxFQIAERgUMkE1MzBCRjMyQzg2ODUzRjBDNzQA_video_wamid.HB.mp4` | 3.63 | messages.media_url (ID: 63be1fd4-c68b-4e02-92e7-e4ea1394d202) |
| 10 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIzMzMyNDcxFQIAERgUMkE2OTkyRDRFM0UwQkRGNkE5ODQA_video_wamid.HB.mp4` | 8.78 | messages.media_url (ID: cf21d5b8-02ae-44b3-be7a-fb544f0a8687) |
| 11 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIzMzMyNDcxFQIAERgUMkE5QTc3OTRBMEM1M0QwMjBBNDEA_video_wamid.HB.mp4` | 2.60 | messages.media_url (ID: aaa9e736-ca62-4ef5-b45a-f1c5e50f4e07) |
| 12 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIzMzMyNDcxFQIAERgUMkFGOTU3RUNENjNCOUNCQzRCOTcA_video_wamid.HB.mp4` | 2.63 | messages.media_url (ID: 14fb1ed0-e153-4a0b-8e98-eee705dfedd6) |
| 13 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzY2NzY5NDAyFQIAERgUMkFFRURCRTAxMTdCODdGNTIyQ0MA_video_wamid.HB.mp4` | 0.91 | messages.media_url (ID: d92ccd11-2549-46ce-93ff-987614ebb19d) |
| 14 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUMkE0QzBCMUZCNDJFNkUwMjlGQjgA_Dispepsi_O_mera_Ali_Arapc_a_Bas_kent-TR.mp4` | 48.50 | messages.media_url (ID: a0bb4825-c934-4f09-8797-89488eb65363) |
| 15 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUMkE5Q0VFQjM2NDNDM0FCQzk3QTIA_Makedon_Hasta_I_NGI_LI_ZCE.mp4` | 92.97 | messages.media_url (ID: c5683e95-c01b-4802-bfab-739b45c10418) |
| 16 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUMkEwNUY3N0VERjRENDgxNUNGOUQA_Diz_Eklem_TR.mp4` | 78.44 | messages.media_url (ID: 8edbc11a-5eb5-4fd7-b90b-601ca8a02cc9) |
| 17 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUMkFEMjY1MjY2Q0RFNDVFOUE2REEA_TR_Memem_Kanseri_O_mer_Final.mp4` | 84.16 | messages.media_url (ID: 92b79701-d48a-4ec8-8ed5-c8f3aff8b0e5) |
| 18 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUMkFEQTY0M0MwOEQ2NjBFMDFFMkQA_Almanya_Bel_F_t_g__-Bel_Kaymas__Hastas__rev.mp4` | 48.50 | messages.media_url (ID: 090af367-0944-4698-b918-5c905b2191f9) |
| 19 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEE2NDRFNzhBRjFCRjc2RTJDMTMA_video_wamid.HB.mp4` | 6.68 | messages.media_url (ID: 0b1c7044-7b07-4920-b170-b1da535d0c6c) |
| 20 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEE4MjlBNEE4OUQ2NzkxQjc4QjMA_video_wamid.HB.mp4` | 10.69 | messages.media_url (ID: 2b9c371e-ed02-49f9-9f78-43110ab006a4) |
| 21 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEE4NDMzMzRBMDg1NUVERjVFQkQA_video_wamid.HB.mp4` | 10.03 | messages.media_url (ID: 1a75ad7f-3bd7-4f1a-8452-d9f62b793a54) |
| 22 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEE5MjY2RTAyMTU2NjZCNTRCRkEA_video_wamid.HB.mp4` | 9.99 | messages.media_url (ID: 67a412a7-e4b9-441d-b1f1-c7908ae4c546) |
| 23 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEEzRjlCODg5REI3RjBGRDc2NDMA_video_wamid.HB.mp4` | 11.07 | messages.media_url (ID: a92d84b0-e71d-4ae7-8e36-b14c335ef370) |
| 24 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEFBRTUyOEJGMUI3NzAyRTE4MTkA_video_wamid.HB.mp4` | 9.59 | messages.media_url (ID: 82670fd7-5f4c-480d-a7f1-b90595c86d25) |
| 25 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEFCREYzNTZCMzA2QzgyNUQ1RDEA_video_wamid.HB.mp4` | 6.69 | messages.media_url (ID: 235c8e37-5966-4e1d-a9cb-df0f694f65d5) |
| 26 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEFDNjAwMjFCRjFBRTI1NDQ1ODkA_video_wamid.HB.mp4` | 8.46 | messages.media_url (ID: d6978c46-4cfb-425b-9de7-046ff1ca88b2) |
| 27 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEFGOEQxNEE3MDREQTBENDkxODQA_video_wamid.HB.mp4` | 9.52 | messages.media_url (ID: 78e9fbd9-9672-4577-8819-549b533024d9) |
| 28 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NDM5NjUzMDE3FQIAERgUNEFGRDkxRDg4QUZEQ0U4RTVBMUYA_video_wamid.HB.mp4` | 6.07 | messages.media_url (ID: 6da0e54c-7ff6-4205-ad3b-4ef6d839f6e4) |
| 29 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTYyNzk1NTY2MjA1FQIAEhgUM0E1QTk5QTJFODM1QTlFQTgxQTgA_Almanya_Bel_F_t_g__-Bel_Kaymas__Hastas__rev.mp4` | 48.50 | messages.media_url (ID: a9a1f146-b48d-42f0-ac82-d86b2b8b2c5f) |
| 30 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTYyNzk1NTY2MjA1FQIAEhgUM0E4NDMxNjgyMDFCODNCOEUzRjMA_Diz_Eklem_TR.mp4` | 78.44 | messages.media_url (ID: 0e86ed88-52ff-4078-a9e5-f99306b91214) |
| 31 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTYyNzk1NTY2MjA1FQIAEhgUM0E4OEJGQjcxOUY1ODI4RjQzQzQA_Dispepsi_O_mera_Ali_Arapc_a_Bas_kent-TR.mp4` | 48.50 | messages.media_url (ID: d552cdf8-a653-4c86-afd1-640313df3124) |
| 32 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTYyNzk1NTY2MjA1FQIAEhgUM0E4Q0UxNUU3Q0Y1OTk2QzEwQTIA_TR_Memem_Kanseri_O_mer_Final.mp4` | 84.16 | messages.media_url (ID: 192fbd79-9cba-4bcf-8db1-e3a49e088297) |
| 33 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTYyNzk1NTY2MjA1FQIAEhgUM0EwM0Q5MTNEOThCNjVDRUVBQ0UA_Makedon_Hasta_I_NGI_LI_ZCE.mp4` | 92.97 | messages.media_url (ID: a9a09a91-a618-442a-863d-517e3b950704) |
| 34 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTYyNzk1NTY2MjA1FQIAEhgUM0FBODU0RUY1QzdBOEM5NkJCMjEA_TR_Memem_Kanseri_O_mer_Final.mp4` | 84.16 | messages.media_url (ID: 64e55258-6cac-4ca7-85c6-9e1a9af833be) |
| 35 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgNOTY0NzcwNTExODE1MBUCABEYFDJBQ0I2QTE4NDM3NkNGMjlGMzcxAA==_video_wamid.HB.mp4` | 5.81 | messages.media_url (ID: f1ee7232-e223-443e-aa56-ad45e3f1c7bd) |
| 36 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgNOTY0NzcwNTExODE1MBUCABIYIEFDQjM3MDY4RTFEQkZENURCMjJGODdCNzE1NjE4QTI1AA==_video_wamid.HB.mp4` | 5.81 | messages.media_url (ID: c67f57bf-76da-464b-9e22-5628c6747306) |

### 3. Other Tenant MP4s (Safety Excluded)

No other tenant MP4s found.

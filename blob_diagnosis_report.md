# Vercel Blob Storage Diagnosis Report (Dry-Run)

**Date of Diagnosis**: 2026-06-20T21:16:19.779Z
**Total Blobs**: 195
**Total Size**: 58.84 MB (0.057 GB)

### Categories Breakdown
* **Active Blobs (Referenced in DB)**: 133 files
* **Orphan Candidates (Older than 14 days, safe to delete)**: 62 files (19.65 MB)
* **New Blobs (Safety Excluded, < 14 days old)**: 0 files (0.00 MB)
* **Other Tenant Blobs (Tenant Isolation Excluded)**: 0 files (0.00 MB)

## Top 20 Largest Blobs

| # | Pathname | Size (MB) | Uploaded At |
|---|----------|-----------|-------------|
| 1 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/2155d249-e60_1780659656982.jpg` | 3.59 | Fri Jun 05 2026 14:40:58 GMT+0300 (Türkiye Standard Time) |
| 2 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JEMTMxMkVDNkU2M0YxQkMwNjEA_K_z_I_steme_Katalog_2026_O_zelm.pdf` | 2.61 | Mon May 25 2026 07:18:41 GMT+0300 (Türkiye Standard Time) |
| 3 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/7b5cf567-57e_1779893201468.png` | 2.38 | Wed May 27 2026 17:46:42 GMT+0300 (Türkiye Standard Time) |
| 4 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIzMzMyNDcxFQIAEhggQUNDM0ZGQkQ2M0IxOEU1OTk2QkExMUMyREUwQTNBNEYA_ZEU2026000000208-ROA_ABDEL_RAZZAN_SHAR_F_SAADALD_N.pdf` | 2.26 | Wed Jun 10 2026 14:00:38 GMT+0300 (Türkiye Standard Time) |
| 5 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzIzMzMyNDcxFQIAEhggQUM3NUQ2Qzk1QzJGMEFENzE3MTkwMTJERUJENTBEOUMA_ZEU2026000000209-ROA_ABDEL_RAZZAN_SHAR_F_SAADALD_N.pdf` | 2.26 | Wed Jun 10 2026 14:00:38 GMT+0300 (Türkiye Standard Time) |
| 6 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NTM1ODc0MjYwFQIAEhgUM0E3QzM2MEY1MTczRjI2RTc5OTEA_IMG_6333.JPG` | 1.13 | Tue Jun 02 2026 20:24:13 GMT+0300 (Türkiye Standard Time) |
| 7 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzYyMjEyOTg2FQIAEhgUM0ExMDQ1NEZDMjNFNDlDMjNEODcA_Copie_pass_Yo_page_1.pdf` | 1.09 | Thu Jun 11 2026 21:22:58 GMT+0300 (Türkiye Standard Time) |
| 8 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MzYyMjEyOTg2FQIAEhgUM0E4OTczRUZEQzcyMjA3MDkxMzkA_Copie_pass_Yo_page_2.pdf` | 0.84 | Thu Jun 11 2026 21:22:58 GMT+0300 (Türkiye Standard Time) |
| 9 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NTIwMTI0MjQyFQIAERgUMkFEMkM1RkMzNDI5MUUyNDJCRDcA_Copie_pass_Yo_page_2.pdf` | 0.84 | Fri Jun 12 2026 13:55:08 GMT+0300 (Türkiye Standard Time) |
| 10 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/f0260c2f-3ff_1780596054156.png` | 0.79 | Thu Jun 04 2026 21:00:55 GMT+0300 (Türkiye Standard Time) |
| 11 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I4NTM5OEJGQjkzQjNEOTRCREUA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 02:30:53 GMT+0300 (Türkiye Standard Time) |
| 12 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I4RTc2OTIyNzQyNzdEQzNGNkQA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 03:59:32 GMT+0300 (Türkiye Standard Time) |
| 13 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0IwQjNBRjdBQUM4RTEwRDdGNDgA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 15:04:57 GMT+0300 (Türkiye Standard Time) |
| 14 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JENDY3MEFGRjcwNUM1NEYzOTkA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 04:36:16 GMT+0300 (Türkiye Standard Time) |
| 15 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JGMUMyRTFDODY5MzZFQjdBMDYA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 02:54:40 GMT+0300 (Türkiye Standard Time) |
| 16 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/66565269-60c_1779798107418.pdf` | 0.71 | Tue May 26 2026 15:21:48 GMT+0300 (Türkiye Standard Time) |
| 17 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/a997a6c3-4fa_1779760361696.pdf` | 0.71 | Tue May 26 2026 04:52:42 GMT+0300 (Türkiye Standard Time) |
| 18 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/ae7d5ee4-6ae_1780423201442.pdf` | 0.71 | Tue Jun 02 2026 21:00:02 GMT+0300 (Türkiye Standard Time) |
| 19 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c577b7cd-a54_1779797615054.pdf` | 0.71 | Tue May 26 2026 15:13:36 GMT+0300 (Türkiye Standard Time) |
| 20 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c59d6db4-538_1779797656640.pdf` | 0.71 | Tue May 26 2026 15:14:17 GMT+0300 (Türkiye Standard Time) |

## Orphan Candidates for Deletion (Dry-Run)

| # | Pathname | Size (MB) | Uploaded At |
|---|----------|-----------|-------------|
| 1 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JEMTMxMkVDNkU2M0YxQkMwNjEA_K_z_I_steme_Katalog_2026_O_zelm.pdf` | 2.61 | Mon May 25 2026 07:18:41 GMT+0300 (Türkiye Standard Time) |
| 2 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/7b5cf567-57e_1779893201468.png` | 2.38 | Wed May 27 2026 17:46:42 GMT+0300 (Türkiye Standard Time) |
| 3 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/f0260c2f-3ff_1780596054156.png` | 0.79 | Thu Jun 04 2026 21:00:55 GMT+0300 (Türkiye Standard Time) |
| 4 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I4NTM5OEJGQjkzQjNEOTRCREUA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 02:30:53 GMT+0300 (Türkiye Standard Time) |
| 5 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I4RTc2OTIyNzQyNzdEQzNGNkQA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 03:59:32 GMT+0300 (Türkiye Standard Time) |
| 6 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0IwQjNBRjdBQUM4RTEwRDdGNDgA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 15:04:57 GMT+0300 (Türkiye Standard Time) |
| 7 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JENDY3MEFGRjcwNUM1NEYzOTkA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 04:36:16 GMT+0300 (Türkiye Standard Time) |
| 8 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JGMUMyRTFDODY5MzZFQjdBMDYA_Ekran_Resmi_2026-05-25_22.29.02.pdf` | 0.71 | Tue May 26 2026 02:54:40 GMT+0300 (Türkiye Standard Time) |
| 9 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/66565269-60c_1779798107418.pdf` | 0.71 | Tue May 26 2026 15:21:48 GMT+0300 (Türkiye Standard Time) |
| 10 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/a997a6c3-4fa_1779760361696.pdf` | 0.71 | Tue May 26 2026 04:52:42 GMT+0300 (Türkiye Standard Time) |
| 11 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c577b7cd-a54_1779797615054.pdf` | 0.71 | Tue May 26 2026 15:13:36 GMT+0300 (Türkiye Standard Time) |
| 12 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c59d6db4-538_1779797656640.pdf` | 0.71 | Tue May 26 2026 15:14:17 GMT+0300 (Türkiye Standard Time) |
| 13 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/b56e781e-2bb_1779797666527.png` | 0.60 | Tue May 26 2026 15:14:27 GMT+0300 (Türkiye Standard Time) |
| 14 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c27c136c-9a8_1779797124786.png` | 0.60 | Tue May 26 2026 15:05:26 GMT+0300 (Türkiye Standard Time) |
| 15 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/cdf6c7bd-e05_1779798103435.png` | 0.60 | Tue May 26 2026 15:21:44 GMT+0300 (Türkiye Standard Time) |
| 16 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I3NDA5MzRDQ0UwQTNDMDY4QTgA_image_wamid.HB.jpg` | 0.37 | Tue May 26 2026 04:21:28 GMT+0300 (Türkiye Standard Time) |
| 17 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JCRUJBNTU4NkQxRTFCNDcxQzAA_image_wamid.HB.jpg` | 0.37 | Tue May 26 2026 03:02:45 GMT+0300 (Türkiye Standard Time) |
| 18 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JENjRGQkZDRjRERTRCNUQ1QTEA_image_wamid.HB.jpg` | 0.37 | Tue May 26 2026 02:26:37 GMT+0300 (Türkiye Standard Time) |
| 19 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I2QUI4OTg4MDM2NUU0RDQ4QTQA_image_wamid.HB.jpg` | 0.36 | Tue May 26 2026 02:54:40 GMT+0300 (Türkiye Standard Time) |
| 20 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I5MTQ1RjNGMThBMEUyNUU1NzkA_image_wamid.HB.jpg` | 0.36 | Tue May 26 2026 03:59:32 GMT+0300 (Türkiye Standard Time) |
| 21 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0IxQ0JEQkVCMzAzMUIyMDVFOTUA_image_wamid.HB.jpg` | 0.36 | Tue May 26 2026 04:36:16 GMT+0300 (Türkiye Standard Time) |
| 22 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JGQTMyMDAxODk4RkE0NTE5MzYA_image_wamid.HB.jpg` | 0.36 | Tue May 26 2026 04:19:41 GMT+0300 (Türkiye Standard Time) |
| 23 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/94d14eee-808_1779798094568.png` | 0.23 | Tue May 26 2026 15:21:35 GMT+0300 (Türkiye Standard Time) |
| 24 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JBNEE1RkFCQjIxOURGMDBENTQA_image_wamid.HB.jpg` | 0.22 | Tue Jun 02 2026 15:34:02 GMT+0300 (Türkiye Standard Time) |
| 25 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/843523ce-787_1780650710990.png` | 0.21 | Fri Jun 05 2026 12:11:52 GMT+0300 (Türkiye Standard Time) |
| 26 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/b3ac4ce8-05b_1780650694659.png` | 0.21 | Fri Jun 05 2026 12:11:35 GMT+0300 (Türkiye Standard Time) |
| 27 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/3ae46f17-0eb_1779798100056.png` | 0.18 | Tue May 26 2026 15:21:41 GMT+0300 (Türkiye Standard Time) |
| 28 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/71c7e310-881_1779797663200.png` | 0.18 | Tue May 26 2026 15:14:24 GMT+0300 (Türkiye Standard Time) |
| 29 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgLMjI3OTIxODQ3NTIVAgASGCBBQzU2NEFDOEExNUVFQTFCRjU3RTZDMTE5OTE3QUMwRgA=_sticker_wamid.HB.webp` | 0.17 | Sat Jun 06 2026 14:03:39 GMT+0300 (Türkiye Standard Time) |
| 30 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/33346382-493_1779797660454.png` | 0.14 | Tue May 26 2026 15:14:21 GMT+0300 (Türkiye Standard Time) |
| 31 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/ed649d87-82a_1779798097231.png` | 0.14 | Tue May 26 2026 15:21:38 GMT+0300 (Türkiye Standard Time) |
| 32 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c52de211-933_1780423021923.png` | 0.12 | Tue Jun 02 2026 20:57:03 GMT+0300 (Türkiye Standard Time) |
| 33 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MDEwMTU0MjQyFQIAEhgUMkFCRDZBNUZCN0Y2MUQzNDg5NTkA_image_wamid.HB.jpg` | 0.10 | Tue Jun 02 2026 21:55:46 GMT+0300 (Türkiye Standard Time) |
| 34 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JBNEQ2QUZFQjM0ODAyRTgwOEQA_image_wamid.HB.jpg` | 0.10 | Mon May 25 2026 07:18:02 GMT+0300 (Türkiye Standard Time) |
| 35 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTk2NzcwMjc5MjQxFQIAEhggQUM3M0Q3RTVCNjhDOUMyQ0JDOUQyRkY2RDc3ODFGNTAA_image_wamid.HB.jpg` | 0.08 | Wed Jun 03 2026 17:53:25 GMT+0300 (Türkiye Standard Time) |
| 36 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTk2NzcwMjc5MjQxFQIAEhggQUM2Mjk4NTQ5Q0RBN0U3ODI2RjE5NzlCMEE2RUU3RTgA_image_wamid.HB.jpg` | 0.08 | Wed Jun 03 2026 17:53:27 GMT+0300 (Türkiye Standard Time) |
| 37 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1MDEwMTU0MjQyFQIAEhgUMkFBNzFDMkZDNTlBM0NGOTJDQzcA_image_wamid.HB.jpg` | 0.08 | Tue Jun 02 2026 21:55:47 GMT+0300 (Türkiye Standard Time) |
| 38 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0IxQzhFMUM1NkM1NUE3RURFRTAA_image_wamid.HB.jpg` | 0.07 | Fri Jun 05 2026 03:33:35 GMT+0300 (Türkiye Standard Time) |
| 39 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/f0dde539-630_1779798090809.png` | 0.06 | Tue May 26 2026 15:21:32 GMT+0300 (Türkiye Standard Time) |
| 40 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-06/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JGQjg4RUI3OEZBN0M5ODJENUEA_image_wamid.HB.jpg` | 0.06 | Fri Jun 05 2026 00:12:41 GMT+0300 (Türkiye Standard Time) |
| 41 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I3Q0VERjY0NDQyOUI1MzA4MzkA_image_wamid.HB.jpg` | 0.05 | Sun May 31 2026 00:59:54 GMT+0300 (Türkiye Standard Time) |
| 42 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0JBMjc4NkIyQ0JBOUY4NjczRDMA_image_wamid.HB.jpg` | 0.05 | Tue May 26 2026 02:54:40 GMT+0300 (Türkiye Standard Time) |
| 43 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0FCRTEwOUMwODJFRTdCNEUwQTUA_image_wamid.HB.jpg` | 0.05 | Wed May 27 2026 04:38:59 GMT+0300 (Türkiye Standard Time) |
| 44 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/5df1b365-d76_1779760342638.jpg` | 0.05 | Tue May 26 2026 04:52:23 GMT+0300 (Türkiye Standard Time) |
| 45 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/85717bec-9de_1779759192330.jpg` | 0.05 | Tue May 26 2026 04:33:13 GMT+0300 (Türkiye Standard Time) |
| 46 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/87619d79-e9c_1779759118530.jpg` | 0.05 | Tue May 26 2026 04:31:59 GMT+0300 (Türkiye Standard Time) |
| 47 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/c3f73e5d-209_1779797618553.jpg` | 0.05 | Tue May 26 2026 15:13:39 GMT+0300 (Türkiye Standard Time) |
| 48 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/dc6bf8af-d47_1779760279202.jpg` | 0.05 | Tue May 26 2026 04:51:20 GMT+0300 (Türkiye Standard Time) |
| 49 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/outbound/fb4530af-a9c_1779797432249.jpg` | 0.05 | Tue May 26 2026 15:10:33 GMT+0300 (Türkiye Standard Time) |
| 50 | `media/caab9ea1-9591-45e4-bbc5-9c9b498982c8/2026-05/wamid.HBgMOTA1NTQ2ODMzMzA2FQIAEhgUM0I0RkM3NTQzNjIxRThCMDc5MUYA_image_wamid.HB.jpg` | 0.04 | Tue May 26 2026 04:36:17 GMT+0300 (Türkiye Standard Time) |

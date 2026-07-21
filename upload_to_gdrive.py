#!/usr/bin/env python3
"""
Upload ODSS archive to Google Drive.
"""
import os
import sys

FOLDER_ID = "1hx2iTesjauPSTjXt_HbtEpBpZqJ2-YMB"
FILE_PATH = "/tmp/odss-complete-backup.tar.gz"

print("=" * 60)
print("  ODSS Archive Upload to Google Drive")
print("=" * 60)
print()
print(f"File to upload: {FILE_PATH}")
print(f"Size: {os.path.getsize(FILE_PATH) / (1024*1024):.1f} MB")
print(f"Destination folder: {FOLDER_ID}")
print()

# Check if we have Google Drive API credentials
cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '')
if not cred_path or not os.path.exists(cred_path):
    print("No Google Drive API credentials found on this sandbox.")
    print("Cannot upload directly from sandbox to Google Drive.")
    print()
    print("ALTERNATIVE: Upload manually via browser")
    print("  1. Download the backup file from sandbox")
    print("  2. Upload to: https://drive.google.com/drive/folders/1hx2iTesjauPSTjXt_HbtEpBpZqJ2-YMB")
    sys.exit(1)

try:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_file(
        cred_path, scopes=['https://www.googleapis.com/auth/drive']
    )
    service = build('drive', 'v3', credentials=creds)

    file_metadata = {
        'name': 'odss-complete-backup.tar.gz',
        'parents': [FOLDER_ID]
    }
    media = MediaFileUpload(FILE_PATH, resumable=True)

    print("Uploading...")
    request = service.files().create(
        body=file_metadata,
        media_body=media,
        fields='id'
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"  {int(status.progress() * 100)}%")

    print()
    print("UPLOAD COMPLETE!")
    print(f"File ID: {response.get('id')}")

except Exception as e:
    print(f"Upload failed: {e}")
    print()
    print("ALTERNATIVE: Upload manually via browser")
    sys.exit(1)

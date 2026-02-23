"""Storage backend implementations for ESPScanCam.

Provides pluggable backends for exporting processed scan batches to
various storage targets: local filesystem, Paperless-NGX, WebDAV,
Google Drive, and SMB/CIFS shares.
"""

import os
import glob
import shutil
from abc import ABC, abstractmethod
from datetime import datetime, timezone

import aiohttp

from config import get_data_dir

# ---------------------------------------------------------------------------
# Optional dependency imports
# ---------------------------------------------------------------------------

try:
    from smbprotocol.connection import Connection as _SMBConnection  # noqa: F401
    from smbprotocol.session import Session as _SMBSession  # noqa: F401
    from smbprotocol.tree import TreeConnect as _SMBTree  # noqa: F401
    from smbprotocol.open import Open as _SMBOpen, CreateDisposition, FileAttributes, ShareAccess, ImpersonationLevel, CreateOptions, FilePipePrinterAccessMask  # noqa: F401
    HAS_SMB = True
except ImportError:
    HAS_SMB = False

try:
    from google.oauth2 import service_account as _google_sa  # noqa: F401
    HAS_GDRIVE = True
except ImportError:
    HAS_GDRIVE = False


# ---------------------------------------------------------------------------
# Filename template renderer
# ---------------------------------------------------------------------------

def render_filename(template: str, batch_id: str, batch_data: dict) -> str:
    """Replace template variables in a filename string.

    Supported variables:
        {date}       - current date as YYYY-MM-DD
        {time}       - current time as HH-MM-SS
        {batch_id}   - the batch identifier
        {page_count} - number of pages in the batch
        {profile}    - processing profile name
    """
    now = datetime.now(timezone.utc)
    replacements = {
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H-%M-%S"),
        "batch_id": batch_id,
        "page_count": str(batch_data.get("page_count", 0)),
        "profile": batch_data.get("profile", "default"),
    }
    result = template
    for key, value in replacements.items():
        result = result.replace("{" + key + "}", value)
    return result


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------

class StorageBackend(ABC):
    """Abstract base for all storage backends."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable backend name (e.g. 'local', 'paperless')."""
        ...

    @abstractmethod
    async def upload(self, export_dir: str, batch_id: str, batch_data: dict) -> dict:
        """Upload exported files to the storage target.

        Args:
            export_dir: Directory containing the processed files (images, PDF).
            batch_id: Unique batch identifier.
            batch_data: Dict of batch metadata (page_count, profile, etc.).

        Returns:
            ``{"success": True/False, "message": "...", "path": "..."}``
        """
        ...

    @abstractmethod
    async def test_connection(self) -> dict:
        """Verify that the backend is reachable and credentials are valid.

        Returns:
            ``{"success": True/False, "message": "..."}``
        """
        ...


# ---------------------------------------------------------------------------
# Local filesystem
# ---------------------------------------------------------------------------

class LocalStorage(StorageBackend):
    """Copy exported files to a local directory."""

    def __init__(self, config: dict):
        self._path = config.get("path", os.path.join(get_data_dir(), "exports"))
        self._template = config.get("filename_template", "{date}_{batch_id}")

    @property
    def name(self) -> str:
        return "local"

    async def upload(self, export_dir: str, batch_id: str, batch_data: dict) -> dict:
        try:
            folder_name = render_filename(self._template, batch_id, batch_data)
            dest_dir = os.path.join(self._path, folder_name)
            os.makedirs(dest_dir, exist_ok=True)

            # Find files to copy (PDF first, then images)
            copied: list[str] = []
            pdf_path = os.path.join(export_dir, "output.pdf")
            if os.path.isfile(pdf_path):
                dest_file = os.path.join(dest_dir, f"{folder_name}.pdf")
                shutil.copy2(pdf_path, dest_file)
                copied.append(dest_file)
            else:
                # Copy all files from export_dir
                if os.path.isdir(export_dir):
                    for entry in sorted(os.listdir(export_dir)):
                        src = os.path.join(export_dir, entry)
                        if os.path.isfile(src):
                            shutil.copy2(src, os.path.join(dest_dir, entry))
                            copied.append(entry)

            return {
                "success": True,
                "message": f"Copied {len(copied)} file(s) to local storage",
                "path": dest_dir,
            }
        except Exception as exc:
            return {"success": False, "message": str(exc), "path": ""}

    async def test_connection(self) -> dict:
        try:
            os.makedirs(self._path, exist_ok=True)
            test_file = os.path.join(self._path, ".write_test")
            with open(test_file, "w") as f:
                f.write("ok")
            os.remove(test_file)
            return {"success": True, "message": f"Path {self._path} is writable"}
        except Exception as exc:
            return {"success": False, "message": str(exc)}


# ---------------------------------------------------------------------------
# Paperless-NGX
# ---------------------------------------------------------------------------

class PaperlessStorage(StorageBackend):
    """Upload documents to a Paperless-NGX instance via its REST API."""

    def __init__(self, config: dict):
        self._url = config.get("url", "").rstrip("/")
        self._token = config.get("token", "")

    @property
    def name(self) -> str:
        return "paperless"

    def _headers(self) -> dict:
        return {"Authorization": f"Token {self._token}"}

    async def upload(self, export_dir: str, batch_id: str, batch_data: dict) -> dict:
        pdf_path = os.path.join(export_dir, "output.pdf")
        if not os.path.isfile(pdf_path):
            # Fallback: look for any PDF in the directory
            pdfs = glob.glob(os.path.join(export_dir, "*.pdf"))
            if pdfs:
                pdf_path = pdfs[0]
            else:
                return {
                    "success": False,
                    "message": "No PDF file found in export directory",
                    "path": "",
                }

        try:
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field(
                    "document",
                    open(pdf_path, "rb"),
                    filename=f"{batch_id}.pdf",
                    content_type="application/pdf",
                )
                data.add_field("title", f"Scan {batch_id}")

                url = f"{self._url}/api/documents/post_document/"
                async with session.post(url, data=data, headers=self._headers()) as resp:
                    if resp.status in (200, 201, 202):
                        body = await resp.text()
                        return {
                            "success": True,
                            "message": f"Uploaded to Paperless-NGX (status {resp.status})",
                            "path": url,
                        }
                    else:
                        text = await resp.text()
                        return {
                            "success": False,
                            "message": f"Paperless returned HTTP {resp.status}: {text[:200]}",
                            "path": "",
                        }
        except Exception as exc:
            return {"success": False, "message": str(exc), "path": ""}

    async def test_connection(self) -> dict:
        if not self._url:
            return {"success": False, "message": "Paperless URL is not configured"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._url}/api/",
                    headers=self._headers(),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        return {"success": True, "message": "Connected to Paperless-NGX"}
                    else:
                        text = await resp.text()
                        return {
                            "success": False,
                            "message": f"Paperless returned HTTP {resp.status}: {text[:200]}",
                        }
        except Exception as exc:
            return {"success": False, "message": str(exc)}


# ---------------------------------------------------------------------------
# WebDAV
# ---------------------------------------------------------------------------

class WebDAVStorage(StorageBackend):
    """Upload files to a WebDAV server."""

    def __init__(self, config: dict):
        self._url = config.get("url", "").rstrip("/")
        self._username = config.get("username", "")
        self._password = config.get("password", "")
        self._base_path = config.get("path", "/").strip("/")
        self._template = config.get("filename_template", "{date}_{batch_id}")

    @property
    def name(self) -> str:
        return "webdav"

    def _auth(self) -> aiohttp.BasicAuth | None:
        if self._username:
            return aiohttp.BasicAuth(self._username, self._password)
        return None

    async def upload(self, export_dir: str, batch_id: str, batch_data: dict) -> dict:
        pdf_path = os.path.join(export_dir, "output.pdf")
        if not os.path.isfile(pdf_path):
            pdfs = glob.glob(os.path.join(export_dir, "*.pdf"))
            if pdfs:
                pdf_path = pdfs[0]
            else:
                return {
                    "success": False,
                    "message": "No PDF file found in export directory",
                    "path": "",
                }

        filename = render_filename(self._template, batch_id, batch_data) + ".pdf"
        remote_path = f"{self._base_path}/{filename}" if self._base_path else filename
        put_url = f"{self._url}/{remote_path}"

        try:
            async with aiohttp.ClientSession(auth=self._auth()) as session:
                with open(pdf_path, "rb") as f:
                    file_data = f.read()

                async with session.put(
                    put_url,
                    data=file_data,
                    headers={"Content-Type": "application/pdf"},
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if resp.status in (200, 201, 204):
                        return {
                            "success": True,
                            "message": f"Uploaded to WebDAV ({resp.status})",
                            "path": remote_path,
                        }
                    else:
                        text = await resp.text()
                        return {
                            "success": False,
                            "message": f"WebDAV returned HTTP {resp.status}: {text[:200]}",
                            "path": "",
                        }
        except Exception as exc:
            return {"success": False, "message": str(exc), "path": ""}

    async def test_connection(self) -> dict:
        if not self._url:
            return {"success": False, "message": "WebDAV URL is not configured"}
        propfind_path = f"{self._url}/{self._base_path}" if self._base_path else self._url
        try:
            async with aiohttp.ClientSession(auth=self._auth()) as session:
                headers = {"Depth": "0", "Content-Type": "application/xml"}
                async with session.request(
                    "PROPFIND",
                    propfind_path,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status in (200, 207):
                        return {"success": True, "message": "Connected to WebDAV server"}
                    else:
                        text = await resp.text()
                        return {
                            "success": False,
                            "message": f"WebDAV returned HTTP {resp.status}: {text[:200]}",
                        }
        except Exception as exc:
            return {"success": False, "message": str(exc)}


# ---------------------------------------------------------------------------
# Google Drive (service account)
# ---------------------------------------------------------------------------

class GoogleDriveStorage(StorageBackend):
    """Upload files to Google Drive using a service account."""

    SCOPES = ["https://www.googleapis.com/auth/drive.file"]

    def __init__(self, config: dict):
        self._service_account = config.get("service_account")  # JSON dict
        self._folder_id = config.get("folder_id", "")
        self._template = config.get("filename_template", "{date}_{batch_id}")

    @property
    def name(self) -> str:
        return "gdrive"

    def _get_credentials(self):
        """Build google-auth credentials from service account JSON dict."""
        if not HAS_GDRIVE:
            raise RuntimeError("google-auth is not installed")
        if not self._service_account:
            raise RuntimeError("Service account JSON is not configured")
        from google.oauth2 import service_account
        return service_account.Credentials.from_service_account_info(
            self._service_account,
            scopes=self.SCOPES,
        )

    async def _get_access_token(self) -> str:
        """Return a valid access token string."""
        import asyncio
        creds = self._get_credentials()
        # Refresh is synchronous in google-auth; run in executor.
        loop = asyncio.get_running_loop()
        from google.auth.transport.requests import Request as AuthRequest
        await loop.run_in_executor(None, creds.refresh, AuthRequest())
        return creds.token

    async def upload(self, export_dir: str, batch_id: str, batch_data: dict) -> dict:
        if not HAS_GDRIVE:
            return {
                "success": False,
                "message": "google-auth is not installed (pip install google-auth)",
                "path": "",
            }

        pdf_path = os.path.join(export_dir, "output.pdf")
        if not os.path.isfile(pdf_path):
            pdfs = glob.glob(os.path.join(export_dir, "*.pdf"))
            if pdfs:
                pdf_path = pdfs[0]
            else:
                return {
                    "success": False,
                    "message": "No PDF file found in export directory",
                    "path": "",
                }

        filename = render_filename(self._template, batch_id, batch_data) + ".pdf"

        try:
            token = await self._get_access_token()
            headers = {"Authorization": f"Bearer {token}"}

            import json as _json

            # Step 1: initiate resumable upload (metadata)
            metadata = {"name": filename, "mimeType": "application/pdf"}
            if self._folder_id:
                metadata["parents"] = [self._folder_id]

            async with aiohttp.ClientSession() as session:
                # Use multipart upload for simplicity (files < 5 MB boundary is
                # fine; for larger files Google still accepts this).
                upload_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"

                with open(pdf_path, "rb") as f:
                    file_data = f.read()

                # Build a multipart/related body manually
                import uuid as _uuid
                boundary = _uuid.uuid4().hex
                body_parts = (
                    f"--{boundary}\r\n"
                    f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
                    f"{_json.dumps(metadata)}\r\n"
                    f"--{boundary}\r\n"
                    f"Content-Type: application/pdf\r\n\r\n"
                ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")

                headers["Content-Type"] = f"multipart/related; boundary={boundary}"

                async with session.post(
                    upload_url,
                    data=body_parts,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=300),
                ) as resp:
                    if resp.status in (200, 201):
                        resp_json = await resp.json()
                        file_id = resp_json.get("id", "")
                        return {
                            "success": True,
                            "message": f"Uploaded to Google Drive (file id: {file_id})",
                            "path": f"https://drive.google.com/file/d/{file_id}",
                        }
                    else:
                        text = await resp.text()
                        return {
                            "success": False,
                            "message": f"Google Drive returned HTTP {resp.status}: {text[:200]}",
                            "path": "",
                        }
        except Exception as exc:
            return {"success": False, "message": str(exc), "path": ""}

    async def test_connection(self) -> dict:
        if not HAS_GDRIVE:
            return {
                "success": False,
                "message": "google-auth is not installed (pip install google-auth)",
            }
        try:
            token = await self._get_access_token()
            headers = {"Authorization": f"Bearer {token}"}

            params = {"q": f"'{self._folder_id}' in parents" if self._folder_id else "",
                      "pageSize": "1"}

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://www.googleapis.com/drive/v3/files",
                    headers=headers,
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        return {
                            "success": True,
                            "message": "Connected to Google Drive",
                        }
                    else:
                        text = await resp.text()
                        return {
                            "success": False,
                            "message": f"Google Drive returned HTTP {resp.status}: {text[:200]}",
                        }
        except Exception as exc:
            return {"success": False, "message": str(exc)}


# ---------------------------------------------------------------------------
# SMB / CIFS
# ---------------------------------------------------------------------------

class SMBStorage(StorageBackend):
    """Upload files to an SMB/CIFS network share."""

    def __init__(self, config: dict):
        self._server = config.get("url", config.get("server", ""))
        self._share = config.get("share", "")
        self._path = config.get("path", "").strip("/\\")
        self._username = config.get("username", "")
        self._password = config.get("password", "")
        self._port = int(config.get("port", 445))
        self._template = config.get("filename_template", "{date}_{batch_id}")

    @property
    def name(self) -> str:
        return "smb"

    async def upload(self, export_dir: str, batch_id: str, batch_data: dict) -> dict:
        if not HAS_SMB:
            return {
                "success": False,
                "message": "smbprotocol not installed (pip install smbprotocol)",
                "path": "",
            }

        pdf_path = os.path.join(export_dir, "output.pdf")
        if not os.path.isfile(pdf_path):
            pdfs = glob.glob(os.path.join(export_dir, "*.pdf"))
            if pdfs:
                pdf_path = pdfs[0]
            else:
                return {
                    "success": False,
                    "message": "No PDF file found in export directory",
                    "path": "",
                }

        filename = render_filename(self._template, batch_id, batch_data) + ".pdf"

        try:
            import asyncio
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None, self._smb_upload_sync, pdf_path, filename,
            )
            return result
        except Exception as exc:
            return {"success": False, "message": str(exc), "path": ""}

    def _smb_upload_sync(self, local_path: str, filename: str) -> dict:
        """Perform the blocking SMB upload in a thread."""
        from smbprotocol.connection import Connection
        from smbprotocol.session import Session
        from smbprotocol.tree import TreeConnect
        from smbprotocol.open import (
            Open,
            CreateDisposition,
            FileAttributes,
            ShareAccess,
            ImpersonationLevel,
            CreateOptions,
            FilePipePrinterAccessMask,
        )
        import uuid as _uuid

        conn = Connection(_uuid.uuid4(), self._server, self._port)
        conn.connect()
        try:
            session = Session(conn, self._username, self._password)
            session.connect()
            tree = TreeConnect(session, f"\\\\{self._server}\\{self._share}")
            tree.connect()

            remote_path = f"{self._path}\\{filename}" if self._path else filename

            file_open = Open(tree, remote_path)
            file_open.create(
                ImpersonationLevel.Impersonation,
                FilePipePrinterAccessMask.GENERIC_WRITE,
                FileAttributes.FILE_ATTRIBUTE_NORMAL,
                ShareAccess.FILE_SHARE_WRITE,
                CreateDisposition.FILE_OVERWRITE_IF,
                CreateOptions.FILE_NON_DIRECTORY_FILE,
            )
            try:
                with open(local_path, "rb") as f:
                    file_data = f.read()
                file_open.write(file_data, 0)
            finally:
                file_open.close(False)

            tree.disconnect()
            session.disconnect()
        finally:
            conn.disconnect()

        unc_path = f"\\\\{self._server}\\{self._share}\\{remote_path}"
        return {
            "success": True,
            "message": f"Uploaded to SMB share",
            "path": unc_path,
        }

    async def test_connection(self) -> dict:
        if not HAS_SMB:
            return {
                "success": False,
                "message": "smbprotocol not installed (pip install smbprotocol)",
            }
        if not self._server or not self._share:
            return {
                "success": False,
                "message": "SMB server and share must be configured",
            }
        try:
            import asyncio
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, self._smb_test_sync)
            return result
        except Exception as exc:
            return {"success": False, "message": str(exc)}

    def _smb_test_sync(self) -> dict:
        """Perform blocking SMB connect + list in a thread."""
        from smbprotocol.connection import Connection
        from smbprotocol.session import Session
        from smbprotocol.tree import TreeConnect
        from smbprotocol.open import (
            Open,
            CreateDisposition,
            FileAttributes,
            ShareAccess,
            ImpersonationLevel,
            CreateOptions,
            FilePipePrinterAccessMask,
        )
        import uuid as _uuid

        conn = Connection(_uuid.uuid4(), self._server, self._port)
        conn.connect()
        try:
            session = Session(conn, self._username, self._password)
            session.connect()
            tree = TreeConnect(session, f"\\\\{self._server}\\{self._share}")
            tree.connect()

            # Open the target directory to verify it exists
            dir_path = self._path if self._path else ""
            if dir_path:
                dir_open = Open(tree, dir_path)
                dir_open.create(
                    ImpersonationLevel.Impersonation,
                    FilePipePrinterAccessMask.FILE_LIST_DIRECTORY,
                    FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
                    ShareAccess.FILE_SHARE_READ,
                    CreateDisposition.FILE_OPEN,
                    CreateOptions.FILE_DIRECTORY_FILE,
                )
                dir_open.close(False)

            tree.disconnect()
            session.disconnect()
        finally:
            conn.disconnect()

        return {
            "success": True,
            "message": f"Connected to \\\\{self._server}\\{self._share}",
        }


# ---------------------------------------------------------------------------
# Backend registry & factory
# ---------------------------------------------------------------------------

_BACKEND_TYPES: dict[str, type[StorageBackend]] = {
    "local": LocalStorage,
    "paperless": PaperlessStorage,
    "webdav": WebDAVStorage,
    "gdrive": GoogleDriveStorage,
    "smb": SMBStorage,
}


def create_backend(config_dict: dict) -> StorageBackend:
    """Instantiate a single storage backend from a configuration dict.

    The dict must contain a ``"type"`` key whose value is one of:
    ``local``, ``paperless``, ``webdav``, ``gdrive``, ``smb``.

    Raises:
        ValueError: If the type is unknown.
    """
    backend_type = config_dict.get("type", "")
    cls = _BACKEND_TYPES.get(backend_type)
    if cls is None:
        raise ValueError(f"Unknown storage backend type: {backend_type!r}")
    return cls(config_dict)


def get_storage_backends(config: dict) -> list[StorageBackend]:
    """Create backend instances for every *enabled* entry in the config.

    Reads ``config["storage"]["backends"]`` — a list of dicts each having
    at minimum ``"type"`` and optionally ``"enabled"`` (defaults to True).

    Returns:
        List of instantiated :class:`StorageBackend` objects.
    """
    backends_config = config.get("storage", {}).get("backends", [])
    result: list[StorageBackend] = []

    # Inherit the global filename_template as a fallback
    global_template = config.get("storage", {}).get("filename_template", "{date}_{batch_id}")

    for entry in backends_config:
        if not entry.get("enabled", True):
            continue
        # Inject global filename template if the backend entry doesn't have one
        if "filename_template" not in entry:
            entry = {**entry, "filename_template": global_template}
        try:
            result.append(create_backend(entry))
        except ValueError:
            # Skip unknown backend types silently so the rest still work
            pass

    return result

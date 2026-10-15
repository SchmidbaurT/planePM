from urllib.parse import urlsplit, urlunsplit

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

APP_NAME = "SchmidbaurPM"


def get_brand_logo_url():
    url = urlsplit(settings.WEB_URL or "")
    if url.scheme not in {"http", "https"} or not url.netloc:
        raise ImproperlyConfigured("WEB_URL must be an absolute public HTTP(S) URL for email branding")
    path = f"{url.path.rstrip('/')}/brand/schmidbaur-logo.png"
    return urlunsplit((url.scheme, url.netloc, path, "", ""))

from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.template import Context, Engine
from django.test import override_settings

from plane.utils.branding import get_brand_logo_url


@pytest.mark.unit
@pytest.mark.parametrize("base", ["https://pm.example.com", "https://pm.example.com/tools/pm/"])
def test_brand_logo_preserves_deployment_path(base):
    with override_settings(WEB_URL=base):
        assert get_brand_logo_url() == f"{base.rstrip('/')}/brand/schmidbaur-logo.png"


@pytest.mark.unit
@pytest.mark.parametrize("base", [None, "", "/pm", "ftp://pm.example.com"])
def test_brand_logo_requires_public_web_url(base):
    with override_settings(WEB_URL=base), pytest.raises(ImproperlyConfigured):
        get_brand_logo_url()


@pytest.mark.unit
@pytest.mark.parametrize(
    "template_name",
    [
        "auth/forgot_password",
        "auth/magic_signin",
        "exports/analytics",
        "invitations/project_invitation",
        "invitations/workspace_invitation",
        "notifications/issue-updates",
        "notifications/webhook-deactivate",
        "notifications/project_addition",
        "user/email_updated",
        "user/user_activation",
        "user/user_deactivation",
    ],
)
def test_email_branding_without_request(template_name):
    templates = Path(__file__).resolve().parents[4] / "templates"
    engine = Engine(dirs=[str(templates)], libraries={"branding": "plane.utils.templatetags.branding"})
    with override_settings(WEB_URL="https://pm.example.com/tools/pm"):
        html = engine.get_template(f"emails/{template_name}.html").render(
            Context({"forgot_password_url": "https://pm.example.com/reset?token=keep-me", "email": "user@example.com"})
        )
    assert "SchmidbaurPM" in html
    assert 'src="https://pm.example.com/tools/pm/brand/schmidbaur-logo.png"' in html
    if template_name == "auth/forgot_password":
        assert "token=keep-me" in html
    assert "media.docs.plane.so" not in html

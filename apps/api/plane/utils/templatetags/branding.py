from django import template

from plane.utils.branding import APP_NAME, get_brand_logo_url

register = template.Library()


@register.simple_tag
def brand_name():
    return APP_NAME


@register.simple_tag
def brand_logo_url():
    return get_brand_logo_url()

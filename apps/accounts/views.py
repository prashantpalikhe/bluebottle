from apps.bluebottle_drf2.permissions import IsCurrentUserOrReadOnly, IsCurrentUser
from django.contrib.auth import load_backend, login, get_user_model
from django.contrib.auth.forms import PasswordResetForm, SetPasswordForm
from django.contrib.auth.models import AnonymousUser
from django.contrib.sites.models import get_current_site
from django.conf import settings
from django.template import loader
from django.contrib.auth.tokens import default_token_generator
from django.http import Http404
from django.utils.http import base36_to_int, int_to_base36
from registration.models import RegistrationProfile
from rest_framework import generics
from rest_framework import response
from rest_framework import status
from rest_framework import views
from django.utils.translation import ugettext_lazy as _
from .models import BlueBottleUser
from .serializers import (CurrentUserSerializer, UserProfileSerializer, UserSettingsSerializer, UserCreateSerializer,
                          PasswordResetSerializer, PasswordSetSerializer)


# API views

class UserProfileDetail(generics.RetrieveUpdateAPIView):
    model = BlueBottleUser
    serializer_class = UserProfileSerializer
    permission_classes = (IsCurrentUserOrReadOnly,)


class UserSettingsDetail(generics.RetrieveUpdateAPIView):
    model = BlueBottleUser
    serializer_class = UserSettingsSerializer
    permission_classes = (IsCurrentUser,)


class CurrentUser(generics.RetrieveAPIView):
    model = BlueBottleUser
    serializer_class = CurrentUserSerializer

    def get_object(self, queryset=None):
        if isinstance(self.request.user, AnonymousUser):
            raise Http404()
        return self.request.user


class UserCreate(generics.CreateAPIView):
    model = BlueBottleUser
    serializer_class = UserCreateSerializer

    def get_name(self):
        return "Users"


class UserActivate(views.APIView):

    def login_user(self, request, user):
        """
        Log in a user without requiring credentials (using ``login`` from ``django.contrib.auth``, first finding
        a matching backend).
        http://djangosnippets.org/snippets/1547/
        """
        if not hasattr(user, 'backend'):
            for backend in settings.AUTHENTICATION_BACKENDS:
                if user == load_backend(backend).get_user(user.pk):
                    user.backend = backend
                    break
        if hasattr(user, 'backend'):
            return login(request, user)

    def get(self, request, *args, **kwargs):
        activation_key = self.kwargs.get('activation_key', None)
        activated_user = RegistrationProfile.objects.activate_user(activation_key)
        if activated_user:
            # Return 200 and log the user in when the user has been activated.
            self.login_user(request, activated_user)
            return response.Response(status=status.HTTP_200_OK)
        # Return 404 when the activation didn't work.
        return response.Response(status=status.HTTP_404_NOT_FOUND)


class PasswordReset(views.APIView):
    """
    Allows a password reset to be initiated for valid users in the system. An email will be sent to the user with a
    password reset link upon successful submission.
    """
    serializer_class = PasswordResetSerializer

    def save(self, password_reset_form, domain_override=None,
             subject_template_name='registration/password_reset_subject.txt',
             email_template_name='registration/password_reset_email.html', use_https=False,
             token_generator=default_token_generator, from_email=None, request=None):
        """
        Generates a one-use only link for resetting password and sends to the user. This has been ported from the
        Django PasswordResetForm to allow HTML emails instead of plaint text emails.
        """
        # TODO: Create a patch to Django to use user.email_user instead of send_email.
        for user in password_reset_form.users_cache:
            if not domain_override:
                current_site = get_current_site(request)
                site_name = current_site.name
                domain = current_site.domain
            else:
                site_name = domain = domain_override
            c = {
                'email': user.email,
                'domain': domain,
                'site_name': site_name,
                'uid': int_to_base36(user.pk),
                'user': user,
                'token': token_generator.make_token(user),
                'protocol': use_https and 'https' or 'http',
            }
            subject = loader.render_to_string(subject_template_name, c)
            # Email subject *must not* contain newlines
            subject = ''.join(subject.splitlines())
            email = loader.render_to_string(email_template_name, c)
            user.email_user(subject, email)

    def put(self, request, *args, **kwargs):
        password_reset_form = PasswordResetForm()
        serializer = PasswordResetSerializer(password_reset_form=password_reset_form, data=request.DATA)
        if serializer.is_valid():
            opts = {
                'use_https': request.is_secure(),
                'from_email': settings.DEFAULT_FROM_EMAIL,
                'request': request,
            }
            # TODO: When Django Password Reset form uses user.email_user() this can be enabled and the self.save() can
            #       be removed.
            # password_reset_form.save(**opts)  # Sends the email
            self.save(password_reset_form, **opts)  # Sends the email

            return response.Response(status=status.HTTP_200_OK)
        return response.Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PasswordSet(views.APIView):
    """
    Allows a new password to be set in the resource that is a valid password reset hash.
    """
    serializer_class = PasswordSetSerializer

    def put(self, request, *args, **kwargs):
        # The uidb36 and the token are checked by the URLconf.
        uidb36 = self.kwargs.get('uidb36')
        token = self.kwargs.get('token')
        UserModel = get_user_model()
        try:
            uid_int = base36_to_int(uidb36)
            user = UserModel._default_manager.get(pk=uid_int)
        except (ValueError, OverflowError, UserModel.DoesNotExist):
            user = None

        if user is not None and default_token_generator.check_token(user, token):
            password_set_form = SetPasswordForm(user)
            serializer = PasswordSetSerializer(password_set_form=password_set_form, data=request.DATA)
            if serializer.is_valid():
                password_set_form.save()  # Sets the password
                return response.Response(status=status.HTTP_200_OK)
            return response.Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        return response.Response(status=status.HTTP_404_NOT_FOUND)

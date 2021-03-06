# coding=utf-8
import logging
from urllib2 import URLError
from apps.cowry.adapters import AbstractPaymentAdapter
from apps.cowry.models import PaymentStatuses
from django.conf import settings
from django.utils.http import urlencode
from django.utils import timezone
from suds.client import Client
from suds.plugin import MessagePlugin
from .exceptions import DocDataPaymentException
from .models import DocDataPaymentOrder, DocDataPayment

status_logger = logging.getLogger('cowry-docdata.status')
payment_logger = logging.getLogger('cowry-docdata.payment')


# These defaults can be overridden with the COWRY_PAYMENT_METHODS setting.
default_payment_methods = {
    'dd-ideal': {
        'id': 'IDEAL',
        'profile': 'ideal',
        'name': 'iDeal',
        'submethods': {
            '0081': 'Fortis',
            '0021': 'Rabobank',
            '0721': 'ING Bank',
            '0751': 'SNS Bank',
            '0031': 'ABN Amro Bank',
            '0761': 'ASN Bank',
            '0771': 'SNS Regio Bank',
            '0511': 'Triodos Bank',
            '0091': 'Friesland Bank',
            '0161': 'van Lanschot Bankiers'
        },
        'restricted_countries': ('NL',),
        'supports_recurring': False,
    },

    'dd-direct-debit': {
        'id': 'DIRECT_DEBIT',
        'profile': 'directdebit',
        'name': 'Direct Debit',
        'max_amount': 10000,  # €100
        'restricted_countries': ('NL',),
        'supports_recurring': True,
        'supports_single': False,
    },

    'dd-creditcard': {
        'profile': 'creditcard',
        'name': 'Credit Cards',
        'supports_recurring': False,
    },

    'dd-webmenu': {
        'profile': 'webmenu',
        'name': 'Web Menu',
        'supports_recurring': True,
    }
}


class DocDataAPIVersionPlugin(MessagePlugin):
    """
    This adds the API version number to the body element. This is required for the DocData soap API.
    """
    def marshalled(self, context):
        body = context.envelope.getChild('Body')
        request = body[0]
        request.set('version', '1.0')


class DocdataPaymentAdapter(AbstractPaymentAdapter):
    # Mapping of DocData statuses to Cowry statuses.
    status_mapping = {
        'NEW': PaymentStatuses.new,
        'STARTED': PaymentStatuses.in_progress,
        'AUTHORIZED': PaymentStatuses.pending,
        'AUTHORIZATION_REQUESTED': PaymentStatuses.pending,
        'PAID': PaymentStatuses.pending,
        'CANCELLED': PaymentStatuses.cancelled,
        'CHARGED-BACK': PaymentStatuses.cancelled,
        'CONFIRMED_PAID': PaymentStatuses.paid,
        'CONFIRMED_CHARGEDBACK': PaymentStatuses.cancelled,
        'CLOSED_SUCCESS': PaymentStatuses.paid,
        'CLOSED_CANCELLED': PaymentStatuses.cancelled,
    }

    # TODO: Create defaults for this like the payment_methods
    id_to_model_mapping = {
        'dd-ideal': DocDataPayment,
        'dd-direct-debit': DocDataPayment,
        'dd-creditcard': DocDataPayment,
        'dd-webmenu': DocDataPayment,
    }

    def _init_docdata(self):
        # Create the soap client.
        if self.test:
            # Test API URL.
            url = 'https://test.tripledeal.com/ps/services/paymentservice/1_0?wsdl'
        else:
            # Live API URL.
            url = 'https://tripledeal.com/ps/services/paymentservice/1_0?wsdl'

        try:
            self.client = Client(url, plugins=[DocDataAPIVersionPlugin()])
        except URLError as e:
            self.client = None
            payment_logger.warn('Could not connect to DocData: ' + str(e))
        else:
            # Setup the merchant soap object for use in all requests.
            self.merchant = self.client.factory.create('ns0:merchant')
            # TODO: Make this required if adapter is enabled (i.e. throw an error if not set instead of defaulting to dummy).
            self.merchant._name = getattr(settings, "COWRY_DOCDATA_MERCHANT_NAME", None)
            self.merchant._password = getattr(settings, "COWRY_DOCDATA_MERCHANT_PASSWORD", None)

    def __init__(self):
        # TODO Make setting for this.
        self.test = True
        self._init_docdata()

    def get_payment_methods(self):
        # Override the payment_methods if they're set. This isn't in __init__ because
        # we want to override the settings in the tests.
        if not hasattr(self, '_payment_methods'):
            settings_payment_methods = getattr(settings, 'COWRY_PAYMENT_METHODS', None)
            if settings_payment_methods:
                # Only override the parameters that are set.
                self._payment_methods = {}
                for pmi in settings_payment_methods:
                    settings_pm = settings_payment_methods[pmi]
                    if pmi in default_payment_methods:
                        default_pm = default_payment_methods[pmi]
                        for param in settings_pm:
                            default_pm[param] = settings_pm[param]
                        self._payment_methods[pmi] = default_pm
                    else:
                        self._payment_methods[pmi] = settings_pm
            else:
                self._payment_methods = default_payment_methods

        return self._payment_methods

    def create_payment_object(self, payment_method_id='', payment_submethod_id='', amount=0, currency=''):
        payment = DocDataPaymentOrder.objects.create(payment_method_id=payment_method_id,
                                                     payment_submethod_id=payment_submethod_id,
                                                     amount=amount, currency=currency)
        payment.save()
        return payment

    def create_remote_payment_order(self, payment):
        # Some preconditions.
        if payment.payment_order_id:
            raise DocDataPaymentException('ERROR', 'Cannot create two remote DocData Payment orders for same payment.')
        if not payment.payment_method_id:
            raise DocDataPaymentException('ERROR', 'payment_method_id is not set')

        # We can't do anything if DocData isn't available.
        if not self.client:
            self._init_docdata()
            if not self.client:
                return

        # Preferences for the DocData system
        paymentPreferences = self.client.factory.create('ns0:paymentPreferences')
        paymentPreferences.profile = self.get_payment_methods()[payment.payment_method_id]['profile'],
        paymentPreferences.numberOfDaysToPay = 5
        menuPreferences = self.client.factory.create('ns0:menuPreferences')

        # Order Amount.
        amount = self.client.factory.create('ns0:amount')
        amount.value = str(payment.amount)
        amount._currency = payment.currency

        # Customer information.
        language = self.client.factory.create('ns0:language')
        language._code = payment.language

        name = self.client.factory.create('ns0:name')
        name.first = payment.first_name
        name.last = payment.last_name

        shopper = self.client.factory.create('ns0:shopper')
        shopper.gender = "U"  # Send unknown gender.
        shopper.language = language
        shopper.email = payment.email
        shopper._id = payment.customer_id
        shopper.name = name

        # Billing information.
        address = self.client.factory.create('ns0:address')
        address.street = payment.address
        address.houseNumber = 'N/A'
        address.postalCode = payment.postal_code.replace(' ', '')  # Spaces aren't allowed in the DocData postal code.
        address.city = payment.city

        country = self.client.factory.create('ns0:country')
        country._code = payment.country
        address.country = country

        billTo = self.client.factory.create('ns0:destination')
        billTo.address = address
        billTo.name = name

        # Set the description if there's an order.
        description = "1%CLUB"
        orders = payment.orders.all()
        if orders:
            description = orders[0].__unicode__()[:50]

        if self.test:
            # TODO: Make a setting for the prefix. Note this is also used in status changed notification.
            # A unique code for testing.
            payment.merchant_order_reference = ('COWRY-' + str(timezone.now()))[:30].replace(' ', '-')
        else:
            payment.merchant_order_reference = str(payment.id)

        # Execute create payment order request.
        reply = self.client.service.create(self.merchant, payment.merchant_order_reference, paymentPreferences,
                                           menuPreferences, shopper, amount, billTo, description)
        if hasattr(reply, 'createSuccess'):
            payment.payment_order_id = str(reply['createSuccess']['key'])
            self._change_status(payment, PaymentStatuses.in_progress)  # Note: _change_status calls payment.save().
        elif hasattr(reply, 'createError'):
            payment.save()
            error = reply['createError']['error']
            raise DocDataPaymentException(error['_code'], error['value'])
        else:
            payment.save()
            raise DocDataPaymentException('REPLY_ERROR',
                                          'Received unknown reply from DocData. Remote Payment not created.')

    def cancel_payment(self, payment):
        # Some preconditions.
        if not payment.payment_order_id:
            order = payment.orders.all()[0]
            payment_logger.warn('Attempt to cancel payment on Order id {0} which no payment_order_id.'.format(order.id))
            return

        # Execute create payment order request.
        reply = self.client.service.cancel(self.merchant, payment.payment_order_id)
        if hasattr(reply, 'cancelSuccess'):
            for docdata_payment in payment.docdata_payments.all():
                docdata_payment.status = 'CANCELLED'
                docdata_payment.save()
            self._change_status(payment, PaymentStatuses.cancelled)  # Note: change_status calls payment.save().
        elif hasattr(reply, 'cancelError'):
            error = reply['cancelError']['error']
            raise DocDataPaymentException(error['_code'], error['value'])
        else:
            raise DocDataPaymentException('REPLY_ERROR',
                                          'Received unknown reply from DocData. Remote Payment not cancelled.')

    def get_payment_url(self, payment, return_url_base=None):
        """ Return the Payment URL """

        if payment.amount <= 0 or not payment.payment_method_id or \
                not self.id_to_model_mapping[payment.payment_method_id] == DocDataPayment:
            return None

        if not payment.payment_order_id:
            self.create_remote_payment_order(payment)

        # The basic parameters.
        params = {
            'payment_cluster_key': payment.payment_order_id,
            'merchant_name': self.merchant._name,
            'client_language': payment.language,
        }

        # Add a default payment method if the config has an id.
        payment_methods = self.get_payment_methods()
        if hasattr(payment_methods[payment.payment_method_id], 'id'):
            params['default_pm'] = payment_methods[payment.payment_method_id]['id'],

        # Add return urls.
        if return_url_base:
            order = payment.orders.all()[0]
            params['return_url_success'] = return_url_base + '#/support/thanks/' + str(order.id)
            params['return_url_pending'] = return_url_base + '#/support/thanks/' + str(order.id)
            # TODO This assumes that the order is always a donation order. These Urls will be used when buying vouchers
            # TODO too which is incorrect.
            params['return_url_canceled'] = return_url_base + '#/support/donations'
            params['return_url_error'] = return_url_base + '#/support/payment/error'

        # Special parameters for iDeal.
        if payment.payment_method_id == 'dd-ideal' and payment.payment_submethod_id:
            params['ideal_issuer_id'] = payment.payment_submethod_id
            params['default_act'] = 'true'

        if self.test:
            payment_url_base = 'https://test.docdatapayments.com/ps/menu'
        else:
            payment_url_base = 'https://secure.docdatapayments.com/ps/menu'

        # Create a DocDataPayment when we need it.
        docdata_payment = payment.latest_docdata_payment
        if not docdata_payment or not isinstance(docdata_payment, DocDataPayment):
            docdata_payment = DocDataPayment()
            docdata_payment.docdata_payment_order = payment
            docdata_payment.save()

        return payment_url_base + '?' + urlencode(params)

    def update_payment_status(self, payment, status_changed_notification=False):
        # Don't do anything if there's no payment or payment_order_id.
        if not payment or not payment.payment_order_id:
            return

        # Execute status request.
        reply = self.client.service.status(self.merchant, payment.payment_order_id)
        if hasattr(reply, 'statusSuccess'):
            report = reply['statusSuccess']['report']
        elif hasattr(reply, 'statusError'):
            error = reply['statusError']['error']
            status_logger.error("{0}: {1} {2}".format(payment.payment_order_id, error['_code'], error['value']))
            return
        else:
            status_logger.error(
                "{0}: REPLY_ERROR Received unknown status reply from DocData.".format(payment.payment_order_id))
            return

        if not hasattr(report, 'payment'):
            if status_changed_notification:
                status_logger.warn(
                    "{0}: Status changed notification received but status report had no payment reports.".format(
                        payment.payment_order_id))
            return

        statusChanged = False
        for payment_report in report.payment:
            # Find or create the DocDataPayment for current report.
            try:
                ddpayment = DocDataPayment.objects.get(payment_id=str(payment_report.id))
            except DocDataPayment.DoesNotExist:
                ddpayment_list = payment.docdata_payments.filter(status='NEW')
                ddpayment_list_len = len(ddpayment_list)
                if ddpayment_list_len == 0:
                    ddpayment = DocDataPayment()
                    ddpayment.docdata_payment_order = payment
                elif ddpayment_list_len == 1:
                    ddpayment = ddpayment_list[0]
                else:
                    status_logger.error(
                        "{0}: Cannot determine where to save the payment report.".format(payment.payment_order_id))
                    continue

                # Save some information from the report.
                ddpayment.payment_id = str(payment_report.id)
                ddpayment.docdata_payment_method = str(payment_report.paymentMethod)
                ddpayment.save()

            # Some additional checks.
            if not payment_report.paymentMethod == ddpayment.docdata_payment_method:
                status_logger.warn("{0}: Payment method from DocData doesn't match saved payment method.".format(
                    payment.payment_order_id))
                status_logger.warn(
                    "{0}: Storing the payment method received from DocData for payment id {1}: {2}".format(
                        payment.payment_order_id, ddpayment.payment_id, payment_report.paymentMethod))
                ddpayment.docdata_payment_method = str(payment_report.paymentMethod)
                ddpayment.save()

            if not payment_report.authorization.status in DocDataPayment.statuses:
                # Note: We continue to process the payment status change on this error.
                status_logger.error(
                    "{0}: Received unknown payment status from DocData: {1}".format(payment.payment_order_id,
                                                                                    payment_report.authorization.status))

            # Update the DocDataPayment status.
            if ddpayment.status != payment_report.authorization.status:
                status_logger.info("{0}: DocData payment status changed for payment id {1}: {2} -> {3}".format(
                    payment.payment_order_id, payment_report.id, ddpayment.status,
                    payment_report.authorization.status))
                ddpayment.status = str(payment_report.authorization.status)
                ddpayment.save()
                statusChanged = True

        # Log a warning if we've received a status change notification and have no status changes.
        if status_changed_notification and not statusChanged:
            status_logger.warn(
                "{0}: Status changed notification received but no payment status change detected.".format(
                    payment.payment_order_id))
            return

        # Use the latest DocDataPayment status to set the status on the Cowry Payment.
        latest_ddpayment = payment.latest_docdata_payment
        latest_payment_report = None
        for payment_report in report.payment:
            if payment_report.id == latest_ddpayment.payment_id:
                latest_payment_report = payment_report
                break
        old_status = payment.status
        new_status = self._map_status(latest_ddpayment.status, report.approximateTotals,
                                      latest_payment_report.authorization)
        if old_status != new_status:
            status_logger.info("{0}: Payment status changed {1} -> {2}".format(
                payment.payment_order_id,
                old_status,
                new_status))

            if new_status not in PaymentStatuses.values:
                new_status = PaymentStatuses.unknown
            self._change_status(payment, new_status)  # Note: change_status calls payment.save().

    def _map_status(self, status, totals=None, authorization=None):
        return super(DocdataPaymentAdapter, self)._map_status(status)

        # TODO Use status change log to investigate if these overrides are needed.
        # Some status mapping overrides.

        # Integration Manual Order API 1.0 - Document version 1.0, 08-12-2012 - Page 33:
        # Safe route: The safest route to check whether all payments were made is for the merchants
        # to refer to the “Total captured” amount to see whether this equals the “Total registered
        # amount”. While this may be the safest indicator, the downside is that it can sometimes take a
        # long time for acquirers or shoppers to actually have the money transferred and it can be
        # captured.
        # if totals.totalRegistered == totals.totalCaptured:
        #     new_status = 'paid'

        # These overrides are really just guessing.
        # latest_capture = authorization.capture[-1]
        # if status == 'AUTHORIZED':
        #     if hasattr(authorization, 'refund') or hasattr(authorization, 'chargeback'):
        #         new_status = 'cancelled'
        #     if latest_capture.status == 'FAILED' or latest_capture == 'ERROR':
        #         new_status = 'failed'
        #     elif latest_capture.status == 'CANCELLED':
        #         new_status = 'cancelled'

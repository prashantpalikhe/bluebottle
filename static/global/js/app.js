function getCookie(name) {
    var cookieValue = null;
    if (document.cookie && document.cookie != '') {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = jQuery.trim(cookies[i]);
            // Does this cookie string begin with the name we want?
            if (cookie.substring(0, name.length + 1) == (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

var csrf_token = getCookie('csrftoken');

function csrfSafeMethod(method) {
    // these HTTP methods do not require CSRF protection
    return (/^(GET|HEAD|OPTIONS|TRACE)$/.test(method));
}

function sameOrigin(url) {
    // If url starts with / it's relative and same origin
    if (url.substr(0, 1) == '/') {
        return true;
    }
    // test that a given url is a same-origin URL
    // url could be relative or scheme relative or absolute
    var host = document.location.host; // host + port
    var protocol = document.location.protocol;
    var sr_origin = '//' + host;
    var origin = protocol + sr_origin;
    // Allow absolute or scheme relative URLs to same origin
    return (url == origin || url.slice(0, origin.length + 1) == origin + '/') ||
        (url == sr_origin || url.slice(0, sr_origin.length + 1) == sr_origin + '/');
    // or any other URL that isn't scheme relative or absolute i.e relative. !(/^(\/\/|http:|https:).*/.test(url));
}

$.ajaxSetup({
    beforeSend: function(xhr, settings) {
        if (!csrfSafeMethod(settings.type) && sameOrigin(settings.url)) {
            // Send the token to same-origin, relative URLs only.
            // Send the token only if the method warrants CSRF protection
            // Using the CSRFToken value acquired earlier
            xhr.setRequestHeader("X-CSRFToken", csrf_token);
        }
    }
});



Em.TextField.reopen({
    // Update attributeBinding with 'step' and 'multiple'
    attributeBindings: ['type', 'value', 'size', 'step', 'multiple']
});


// TODO Rename App to BlueBottle, BB or BBApp.
App = Em.Application.create({
    VERSION: '1.0.0',

    // TODO: Remove this in production builds.
    LOG_TRANSITIONS: true,


    // We store language & locale here because they need to be available before loading templates.
    language: 'en',
    locale: 'en-GB',
    interfaceLanguages: [
        Em.Object.create({name:'English', code: 'en'}),
        Em.Object.create({name:'Nederlands', code: 'nl'})
    ],

    ready: function() {
        // Read language string from url.
        var language = window.location.pathname.split('/')[1];
        // We don't have to check if it's one of the languages available. Django will have thrown an error before this.
        this.set('language', language);

        // Now that we know the language we can load the handlebars templates.
        //this.loadTemplates(this.templates);

        // Read locale from browser with fallback to default.
        var locale = navigator.language || navigator.userLanguage || this.get('locale');
        if (locale.substr(0, 2) != language) {
            // Some overrides to have a sound expereince, at least for dutch speaking and dutch based users.

            if (language == 'nl') {
                // For dutch language always overwrite locale. Always use dutch locale.
                locale = 'nl';
            }
            if (language == 'en' && locale.substr(0, 2) == 'nl') {
                // For dutch browser viewing english site overwrite locale.
                // We don't want to have dutch fuzzy dates.
                // If fuzzy dates are translated in other languages we should decide if we want to show those.
                locale = 'en';
            }
        }

        App.Page.reopen({
            url: 'pages/' + language + '/pages'
        });
        this.initSelectViews();
        this.setLocale(locale);
        this.initSelectViews();
    },

    initSelectViews: function(){
        // Pre-load these lists so we avoid race conditions when displaying forms
        App.Theme.find().then(function(list){
            App.ThemeSelectView.reopen({
                content: list
            });
        });
        App.Country.find().then(function(list){
            App.CountrySelectView.reopen({
                content: list
            });
            App.CountryCodeSelectView.reopen({
                content: list
            });
        });
        // Get a filtered list of countries that can apply for a project ('oda' countries).
        var filteredList = App.Country.filter(function(item){return item.get('oda')});

        App.ProjectCountrySelectView.reopen({
            content: filteredList
        });
    },

    setLocale: function(locale) {
        if (!locale) {
            locale = this.get('locale');
        }

        if (locale != 'en-US') {
            // Try to load locale specifications.
            $.getScript('/static/assets/js/vendor/globalize-cultures/globalize.culture.' + locale + '.js')
                .fail(function(){
                    console.log("No globalize culture file for : "+ locale);
                    // Specified locale file not available. Use default locale.
                    locale = App.get('locale');
                    Globalize.culture(locale);
                    App.set('locale', locale);
                })
                .success(function(){
                    // Specs loaded. Enable locale.
                    Globalize.culture(locale);
                    App.set('locale', locale);
                });
            $.getScript('/static/assets/js/vendor/jquery-ui/i18n/jquery.ui.datepicker-' + locale.substr(0, 2) + '.js')
                .fail(function(){
                    console.log("No jquery.ui.datepicker file for : "+ locale);
                    // Specified locale file not available. Use default locale.
                    locale = App.get('locale');
                    Globalize.culture(locale);
                    App.set('locale', locale);
                })
                .success(function(){
                    // Specs loaded. Enable locale.
                    App.set('locale', locale);
                });
        } else {
            Globalize.culture(locale);
            App.set('locale', locale);
        }
    }
});

// Now halt the App because we first want to load all templates
App.deferReadiness();

App.loadTemplates = function() {
    var language = window.location.pathname.split('/')[1];
    // TODO: Make sure to avoid race conditions. See if we can dynamically load this as needed.
    // Now that we know the language we can load the handlebars templates.
    var readyCount = 0;
    var templates = Em.A(['users', 'homepage', 'wallposts', 'reactions', 'vouchers', 'tasks', 'projects', 'orders', 'utils', 'blogs']);
    templates.forEach(function(template){
        //loadTemplates(this.templates);
        var hash = {};
        hash.url = '/' + language + '/templates/' + template + '.hbs';
        hash.type = 'GET';
        hash.contentType = 'application/json';
        hash.success = function(data) {
            // Iterate through handlebar tags
            $(data).filter('script[type="text/x-handlebars"]').each(function() {
                var templateName = $(this).attr('data-template-name');
                var raw = $(this).html();
                Em.TEMPLATES[templateName] = Em.Handlebars.compile(raw);
            });
            readyCount++;
            if (readyCount == templates.length) {
                App.advanceReadiness();
            }
        };
        hash.error = function(jqXHR, textStatus, errorThrown) {
            throw errorThrown + ' ' + hash.url;
        };
        jQuery.ajax(hash);

    });
};

App.loadTemplates();


App.deferReadiness();

App.loadTemplates = function() {
        var language = window.location.pathname.split('/')[1];
        // TODO: Make sure to avoid race conditions. See if we can dynamically load this as needed.
        // Now that we know the language we can load the handlebars templates.
        var readyCount = 0;
        var templates = Em.A(['users', 'manage', 'wallposts', 'reactions', 'vouchers', 'tasks', 'projects', 'orders', 'pages']);
        templates.forEach(function(template){
            //loadTemplates(this.templates);
            var hash = {};
            hash.url = '/' + language + '/templates/' + template + '.hbs';
            hash.type = 'GET';
            hash.contentType = 'application/json';
            hash.success = function(data) {
                // Iterate through handlebar tags
                $(data).filter('script[type="text/x-handlebars"]').each(function() {
                    var templateName = $(this).attr('data-template-name');
                    var raw = $(this).html();
                    Em.TEMPLATES[templateName] = Em.Handlebars.compile(raw);
                });
                readyCount++;
                if (readyCount == templates.length) {
                    App.advanceReadiness();
                }
            };
            hash.error = function(jqXHR, textStatus, errorThrown) {
                throw errorThrown + ' ' + hash.url;
            };
            jQuery.ajax(hash);
        });
};

App.loadTemplates();


/*
 * The Ember Data Adapter and Store configuration.
 */
App.Adapter = DS.DRF2Adapter.extend({
    namespace: "i18n/api",

    plurals: {
        "projects/manage": "projects/manage",
        "projects/pitches/manage": "projects/pitches/manage",
        "projects/plans/manage": "projects/plans/manage",
        "projects/campaigns/manage": "projects/campaigns/manage",
        "projects/wallposts/media": "projects/wallposts/media",
        "projects/wallposts/text": "projects/wallposts/text",
        "organizations/manage": "organizations/manage",
        "organizations/addresses/manage": "organizations/addresses/manage",
        "organizations/documents/manage": "organizations/documents/manage",
        "projects/ambassadors/manage": "projects/ambassadors/manage",
        "projects/budgetlines/manage": "projects/budgetlines/manage",
        "fund/paymentinfo": "fund/paymentinfo",
        "fund/paymentmethodinfo": "fund/paymentmethodinfo",
        "users/activate": "users/activate",
        "users/passwordset": "users/passwordset",
        "homepage": "homepage"
    }
});

// Assigning plurals for model properties doesn't seem to work with extend, it does this way:
App.Adapter.configure("plurals", {
    "address": "addresses"
});

App.Adapter.map(
    'App.Payment', {
        availablePaymentMethods: { readOnly: true }
    }
);


App.ApplicationController = Ember.Controller.extend({
    needs: ['currentUser', 'currentOrder', 'myProjectList'],
    display_message: false,

    news: function(){
        return App.NewsPreview.find({language: App.get('language')});
    }.property(),

    displayMessage: (function() {
        if (this.get('display_message') == true) {
            Ember.run.later(this, function() {
                this.hideMessage();
            }, 10000);
        }
    }).observes('display_message'),

    hideMessage: function() {
        this.set('display_message', false);
    }
});


App.ProfileController = Ember.ObjectController.extend({
    addPhoto: function(file) {
        this.set('model.file', file);
    }
});

// Embedded Model Mapping
//
// http://stackoverflow.com/questions/14320925/how-to-make-embedded-hasmany-relationships-work-with-ember-data/14324532#14324532
// The two possible values of embedded are:
//   load: The child records are embedded when loading, but should be saved as standalone records. In order
//         for this to work, the child records must have an ID.
//   always: The child records are embedded when loading, and are saved embedded in the same record. This,
//           of course, affects the dirtiness of the records (if the child record changes, the adapter will
//           mark the parent record as dirty).
App.Adapter.map('App.Project', {
    owner: {embedded: 'load'},
    campaign: {embedded: 'load'},
    plan: {embedded: 'load'},
    country: {embedded: 'load'}
});
App.Adapter.map('App.ProjectPreview', {
    campaign: {embedded: 'load'},
    country: {embedded: 'load'}
});
App.Adapter.map('App.DonationPreview', {
    project: {embedded: 'load'},
    member: {embedded: 'load'}
});
App.Adapter.map('App.WallPost', {
    author: {embedded: 'load'},
    photos: {embedded: 'load'},
    reactions: {embedded: 'load'}
});
App.Adapter.map('App.ProjectWallPost', {
    author: {embedded: 'load'},
    photos: {embedded: 'load'},
    reactions: {embedded: 'load'}
});
App.Adapter.map('App.ProjectTextWallPost', {
    author: {embedded: 'load'},
    photos: {embedded: 'load'},
    reactions: {embedded: 'load'}
});
App.Adapter.map('App.ProjectMediaWallPost', {
    author: {embedded: 'load'},
    photos: {embedded: 'load'},
    reactions: {embedded: 'load'}
});
App.Adapter.map('App.TaskWallPost', {
    author: {embedded: 'load'},
    reactions: {embedded: 'load'}
});
App.Adapter.map('App.WallPostReaction', {
    author: {embedded: 'load'}
});
App.Adapter.map('App.Order', {
    donations: {embedded: 'load'},
    vouchers: {embedded: 'load'}
});
App.Adapter.map('App.CurrentOrder', {
    donations: {embedded: 'load'},
    vouchers: {embedded: 'load'}
});
App.Adapter.map('App.Task', {
    author: {embedded: 'load'},
    tags: {embedded: 'always'},
    members: {embedded: 'load'},
    files: {embedded: 'load'}
});
App.Adapter.map('App.TaskPreview', {
    author: {embedded: 'load'},
    project: {embedded: 'load'}
});
App.Adapter.map('App.TaskMember', {
    member: {embedded: 'load'}
});
App.Adapter.map('App.TaskFile', {
    author: {embedded: 'load'}
});
App.Adapter.map('App.ProjectPlan', {
    tags: {embedded: 'load'},
    country: {embedded: 'load'}
});
App.Adapter.map('App.ProjectPitch', {
    tags: {embedded: 'load'},
    country: {embedded: 'load'}
});
App.Adapter.map('App.MyProjectPlan', {
    ambassadors: {embedded: 'load'},
    budgetLines: {embedded: 'load'},
    tags: {embedded: 'always'}
});
App.Adapter.map('App.MyProjectPitch', {
    tags: {embedded: 'always'}
});
App.Adapter.map('App.MyOrganization', {
    addresses: {embedded: 'both'},
    documents: {embedded: 'load'}
});
App.Adapter.map('App.MyOrganizationDocument', {
    file: {embedded: 'load'}
});

App.Adapter.map('App.Quote', {
    user: {embedded: 'load'}
});

App.Adapter.map('App.News', {
    author: {embedded: 'load'}
});

App.Adapter.map('App.HomePage', {
    projects: {embedded: 'load'},
    slides: {embedded: 'load'},
    quotes: {embedded: 'load'},
    impact: {embedded: 'load'}
});


App.Store = DS.Store.extend({
    adapter: 'App.Adapter'
});


/* Routing */

App.SlugRouter = Em.Mixin.create({
    serialize: function(model, params) {
        if (params.length !== 1) { return {}; }

        var name = params[0], object = {};
        object[name] = get(model, 'slug');

        return object;
    }
});


App.Router.reopen({
    location: 'hash'
});


App.Router.map(function() {

    this.resource('language', {path:'/:lang'});

    // Fix for Facebook logins
    this.route("home", { path: "_=_" });

    this.route("home", { path: "/" });

    this.resource('projectList', {path: '/projects'}, function() {
        this.route('new');
        this.route('search');
    });

    this.resource('error', {path: '/error'}, function() {
        this.route('notFound', {path: '/not-found'});
        this.route('notAllowed', {path: '/not-allowed'});
    });


    this.resource('news', {path: '/news'}, function(){
        this.resource('newsItem', {path: '/:news_id'});
    });

    this.resource('page', {path: '/pages/:slug'});

    this.resource('project', {path: '/projects/:project_id'}, function() {
        this.resource('projectPlan', {path: '/plan'});
        this.resource('projectTaskList', {path: '/tasks'});
        this.resource('projectTaskNew', {path: '/tasks/new'});
        this.resource('projectTask', {path: '/tasks/:task_id'});
        this.resource('projectTaskEdit', {path: '/tasks/:task_id/edit'});
    });

    this.resource('currentOrder', {path: '/support'}, function() {
        this.route('donationList', {path: '/donations'});
        this.route('addDonation', {path: '/donations/add/:project_id'});
        this.route('voucherList', {path: '/giftcards'});
        this.resource('paymentProfile', {path: '/details'});
        this.resource('paymentSelect', {path: '/payment'}, function() {
            this.route('PaymentError', {path: '/error'});
        });
    });

    this.resource('orderThanks', {path: '/support/thanks/:order_id'});

    this.resource('voucherStart', {path: '/giftcards'});
    this.resource('customVoucherRequest', {path: '/giftcards/custom'});
    this.route('customVoucherRequestDone', {path: '/giftcards/custom/done'});

    this.resource('voucherRedeem', {path: '/giftcards/redeem'}, function() {
        this.route('add', {path: '/add/:project_id'});
        this.route('code', {path: '/:code'});
    });
    this.resource('voucherRedeemDone', {path: '/giftcards/redeem/done'});

    this.resource('taskList', {path: '/tasks'});

    this.resource('signup');

    this.resource('user', {path: '/member'}, function() {
        this.resource('userProfile', {path: '/profile/'});
        this.resource('userSettings', {path: '/settings'});
    });

    this.route('userActivate', {path: '/activate/:activation_key'});
    this.resource('passwordReset', {path: '/passwordreset/:reset_token'});

    this.resource('myPitch', {path: '/my/pitches/:my_pitch_id'}, function() {
        this.route('index');
        this.route('basics');
        this.route('description');
        this.route('location');
        this.route('media');
    });

    this.resource('myProject', {path: '/my/projects/:my_project_id'}, function() {
        this.resource('myProjectPlan', {path: 'plan'},function(){
            this.route('index');
            this.route('basics');
            this.route('location');
            this.route('description');
            this.route('media');

            this.route('organisation');
            this.route('legal');
            this.route('ambassadors');

            this.route('bank');
            this.route('campaign');
            this.route('budget');

            this.route('submit');

        });

        this.resource('myProjectPlanReview', {path: 'plan/review'});
        this.resource('myProjectPlanApproved', {path: 'plan/approved'});
        this.resource('myProjectPlanRejected', {path: 'plan/rejected'});

        this.resource('myProjectPitch', {path: 'pitch'}, function(){
            this.route('index');
            this.route('basics');
            this.route('location');
            this.route('media');

            this.route('submit');
        });
        this.resource('myProjectPitchReview', {path: 'pitch/review'});
        this.resource('myProjectPitchApproved', {path: 'pitch/approved'});
        this.resource('myProjectPitchRejected', {path: 'pitch/rejected'});

        this.resource('myProjectCampaign', {path: 'campaign'});

    });

    this.resource('myPitchNew', {path: '/my/pitch/new'});
    this.resource('myProjectList', {path: '/my/projects'});

});


App.ApplicationRoute = Em.Route.extend({

    setupController: function(controller, model){
        this.controllerFor('myProjectList').set('model', App.MyProject.find());

        // FIXME: This totaly breaks donation flow because the unloadRecord trick in CurrrenOrderRoute.model(), somehow.
        // For now ignore. Donation reminder will only be there if you donated during this session...
        //this.controllerFor('currentOrder').set('model',  App.CurrentOrder.find('current'));

        this._super(controller, model);
    },


    events: {
        selectLanguage: function(language) {
            if (language == App.get('language')) {
                // Language already set. Don't do anything;
                return true;
            }
            var languages = App.get('interfaceLanguages');
            for (i in languages) {
                // Check if the selected language is available.
                if (languages[i].code == language) {
                    document.location = '/' + language + document.location.hash;
                    return true;
                }
            }
            language = 'en';
            document.location = '/' + language + document.location.hash;
            return true;
        },

        openInBigBox: function(name, context){
            // Get the controller or create one
            var controller = this.controllerFor(name);
            controller.set('model', context);

            // Get the view. This should be defined.
            var view = App[name.classify() + 'View'].create();
            view.set('controller', controller);

            var modalPaneTemplate = ['<div class="modal-body"><a class="close" rel="close">&times;</a>{{view view.bodyViewClass}}</div>'].join("\n");

            Bootstrap.ModalPane.popup({
                classNames: ['modal', 'large'],
                defaultTemplate: Em.Handlebars.compile(modalPaneTemplate),
                bodyViewClass: view,
                secondary: 'Close'
            });

        },
        openInBox: function(name, context){
            // Get the controller or create one
            var controller = this.controllerFor(name);
            if (context) {
                controller.set('model', context);
            }

            // Get the view. This should be defined.
            var view = App[name.classify() + 'View'].create();
            view.set('controller', controller);

            var modalPaneTemplate = ['<div class="modal-body"><a class="close" rel="close">&times;</a>{{view view.bodyViewClass}}</div>'].join("\n");

            Bootstrap.ModalPane.popup({
                classNames: ['modal'],
                defaultTemplate: Em.Handlebars.compile(modalPaneTemplate),
                bodyViewClass: view
            });

        },
        showTermsAndConditions:  function(){
            // TODO: Use a proper view (static/cms page?) for the body.
            Bootstrap.ModalPane.popup({
                classNames: ['modal'],
                heading: "General Terms & Conditions",
                message: "This needs some text....",
                secondary: 'Close'
            });
        },
        showProject: function(project_id) {
            var route = this;
            App.Project.find(project_id).then(function(project){
                route.transitionTo('project', project);
            });
        },
        showProjectTaskList: function(project_id) {
            var route = this;
            App.Project.find(project_id).then(function(project){
                route.transitionTo('project', project);
                route.transitionTo('projectTaskList');
            });
        },
        showTask: function(task) {
            var route = this;
            App.Project.find(task.get('project.id')).then(function(project){
                route.transitionTo('project', project);
                route.transitionTo('projectTask', task);
            });
        },
        showNews: function(news_id) {
            var route = this;
            App.News.find(news_id).then(function(news){
                route.transitionTo('newsItem', news);
                window.scrollTo(0);
            });
        }
    }
});


/**
 * Project Routes
 */


App.ProjectRoute = Em.Route.extend({
    model: function(params) {
        var page =  App.Project.find(params.project_id);
        var route = this;
        page.on('becameError', function() {
            //route.transitionTo('error.notFound');
            route.transitionTo('projectList');
        });
        return page;
    },

    setupController: function(controller, project) {
        this._super(controller, project);

        // Set the controller to show Project Supporters
        var projectSupporterListController = this.controllerFor('projectSupporterList');
        projectSupporterListController.set('supporters', App.DonationPreview.find({project: project.get('id')}));
        projectSupporterListController.set('page', 1);
        projectSupporterListController.set('canLoadMore', true);
    }
});


// This is the 'ProjectWallPostListRoute'
App.ProjectIndexRoute = Em.Route.extend({
    model: function(params) {
        return this.modelFor('project');
    },

    setupController: function(controller, model) {
        // Empty the items and set page to 0 if project changes so we don't show wall posts from previous project
        if (this.get('model_id') != model.get('id')) {
            controller.set('items', Em.A());
            controller.set('page', 0);
        }
        this.set('model_id', model.get('id'));
        this._super(controller, model.get('wallposts'));
    }
});


App.ProjectPlanRoute = Em.Route.extend({
    model: function(params) {
        return this.modelFor('project').get('plan');
    }
});


// Tasks

App.ProjectTaskListRoute = Em.Route.extend({
    model: function(params) {
        return Em.A();
    },

    setupController: function(controller, model) {
        this._super(controller, model);
        var project = this.modelFor('project');
        var tasks = App.Task.find({project: project.get('id')});
        tasks.addObserver('isLoaded', function(){
            tasks.forEach(function(record) {
                if (record.get('isLoaded')) {
                    controller.get('content').pushObject(record);
                }
            });
        });
    }
});


App.ProjectTaskRoute = Em.Route.extend({
    model: function(params) {
        return App.Task.find(params.task_id);
    },
    setupController: function(controller, model) {
        this._super(controller, model);

        var wallPostController = this.controllerFor('taskWallPostList');
        wallPostController.set('model', model.get('wallposts'));
        wallPostController.set('items', Em.A());
        wallPostController.set('page', 0);
    },
    events: {
        applyForTask: function(task){
            var route = this;
            Bootstrap.ModalPane.popup({
                classNames: ['modal'],
                heading: 'Task',
                message: 'Are you sure you want to apply to this task?',
                primary: 'Apply',
                secondary: 'Cancel',
                callback: function(opts, e) {
                    e.preventDefault();
                    if (opts.primary) {
                        var transaction = route.get('store').transaction();
                        var member = transaction.createRecord(App.TaskMember);
                        member.set('task', task);
                        member.set('created', new Date());
                        transaction.commit();
                    }
                }
            });
        },
        uploadFile: function(task){
            var route = this;
            var controller = this.controllerFor('taskFileNew');
            var view = App.TaskFileNewView.create();
            view.set('controller', controller);
            var transaction = route.get('store').transaction();
            var file = transaction.createRecord(App.TaskFile);
            controller.set('model', file);
            file.set('task', task);

            Bootstrap.ModalPane.popup({
                classNames: ['modal', 'large'],
                heading: task.get('title'),
                bodyViewClass: view,
                primary: 'Save',
                secondary: 'Cancel',
                callback: function(opts, e) {
                    e.preventDefault();
                    if (opts.primary) {
                        transaction.commit();
                    }
                    if (opts.secondary) {
                        transaction.rollback();
                    }
                }
            });
        },
        showMoreWallPosts: function(){
            var controller = this.get('controller');
            var wallPostController = this.controllerFor('taskWallPostList');
            wallPostController.set('canLoadMore', false);
            var page = wallPostController.incrementProperty('page');
            var task = controller.get('model');
            var wps = App.TaskWallPost.find({task: task.get('id'), page: page});
            wps.addObserver('isLoaded', function(){
                wps.forEach(function(record){
                    if (record.get('isLoaded')) {
                        wallPostController.get('content').pushObject(record);
                    }
                });
                wallPostController.set('canLoadMore', true);
            });
        },
        editTaskMember: function(taskMember){
            var route = this;
            var controller = this.controllerFor('taskMemberEdit');
            controller.set('model', taskMember);
            var view = App.TaskMemberEdit.create();
            view.set('controller', controller);
            var transaction = route.get('store').transaction();
            transaction.add(taskMember);

            Bootstrap.ModalPane.popup({
                classNames: ['modal'],
                heading: taskMember.get('member.full_name'),
                bodyViewClass: view,
                primary: 'Save',
                secondary: 'Cancel',
                callback: function(opts, e) {
                    e.preventDefault();
                    if (opts.primary) {
                        transaction.commit();
                    }
                    if (opts.secondary) {
                        transaction.rollback();
                    }
                }
            });
        },
        stopWorkingOnTask: function(task) {
            alert('Not implemented. Sorry!');
        }
    }
});


App.ProjectTaskNewRoute = Em.Route.extend({

    setupController: function(controller, model){
        this._super(controller, model);
        var transaction = this.get('store').transaction();
        model = transaction.createRecord(App.Task);
        controller.set('content', model);
    }
});


App.ProjectTaskEditRoute = Em.Route.extend({
    model: function(params) {
        return App.Task.find(params.task_id);
    },

    setupController: function(controller, model){
        this._super(controller, model);
        // Only start a new transaction if this model hasn't got its own yet.
        if (model.transaction.isDefault) {
            var transaction = this.get('store').transaction();
            transaction.add(model);
        }
    }
});



/**
 * Current Order Routes
 */

// Redirect to the donations list if somebody tries load '/support'.
App.CurrentOrderIndexRoute = Em.Route.extend({
    redirect: function() {
        this.transitionTo('currentOrder.donationList');
    }
});


App.CurrentOrderRoute = Em.Route.extend({
    model: function(params) {
        return App.CurrentOrder.find('current');
    }
});


App.CurrentOrderDonationListRoute = Em.Route.extend({
    model: function(params) {
        var order = this.modelFor('currentOrder');
        return order.get('donations');
    },

    setupController: function(controller, donations) {
        this._super(controller, donations);
        this.controllerFor('currentOrder').set('isVoucherOrder', false);
    }
});


// This route is not really an application state we want but it doesn't seem possible to send a parameter (e.g. the
// project) to a route without having a parameter in the URL. This could be a missing feature in Ember or we could be
// missing something. More investigation is needed if we want to get rid of this route.
// Note: This route allows us to publish urls like; '/support/donations/add/<project slug>'
// which will add a donation the project in the current user's cart.
App.CurrentOrderAddDonationRoute = Em.Route.extend({
    setupController: function (controller, project) {
        var route = this;
        this.modelFor('currentOrder').then(function(order) {
            route.send('addDonation', order, project);
        });
    },

    events: {
        addDonation: function (order, project) {
            if (!Em.isNone(project)) {
                var transaction = this.get('store').transaction();
                var donation = transaction.createRecord(App.CurrentOrderDonation);
                transaction.add(donation);
                donation.set('project', project);
                donation.set('order', order);
                transaction.commit();
            }

            // We're transitioning to the donation list route directly after adding the donation so that the url
            // doesn't show '/support/donations/add/slug' after the donation has been added.
            this.replaceWith('currentOrder.donationList');
        }
    }
});


App.CurrentOrderVoucherListRoute = Em.Route.extend({
    model: function(params) {
        var order = this.modelFor('currentOrder');
        return order.get('vouchers');
    },

    setupController: function(controller, vouchers) {
        this._super(controller, vouchers);
        this.controllerFor('currentOrder').set('isVoucherOrder', true);
    }
});


App.OrderThanksRoute = Em.Route.extend({
    model: function(params) {
        var route = this;
        var order = App.Order.find(params.order_id);
        order.one('becameError', function() {
            route.controllerFor('application').setProperties({
                display_message: true,
                isError: true,
                message_title: "",
                message_content: "Sorry, we can't find your order."
            });
            route.replaceWith('home');
        });
        return order;
    }
});


/**
 * Payment for Current Order Routes
 */

App.PaymentProfileRoute = Em.Route.extend({
    redirect: function() {
        var order = this.modelFor('currentOrder');
        if (order.get('isVoucherOrder')) {
            if (order.get('vouchers.length') <= 0 ) {
                this.transitionTo('currentOrder.voucherList')
            }
        } else {
            if (order.get('donations.length') <= 0 ) {
                this.transitionTo('currentOrder.donationList')
            }
        }

    },

    model: function(params) {
        return App.PaymentProfile.find('current');
    }
});


App.PaymentSelectRoute = Em.Route.extend({
    redirect: function() {
        var order = this.modelFor('currentOrder');
        if (!order.get('paymentProfileComplete')) {
            this.transitionTo('paymentProfile')
        }
    },

    model: function(params) {
        return App.Payment.find('current');
    }
});


App.PaymentSelectPaymentErrorRoute = Em.Route.extend({
    redirect: function() {
        this.controllerFor('currentOrder').setProperties({
            display_message: true,
            isError: true,
            autoHideMessage: false,
            message_content: 'There was an error with your payment. Please try again.'
        });

        var order = this.modelFor('currentOrder');
        if (order.get('isVoucherOrder')) {
            this.replaceWith('currentOrder.voucherList')
        } else {
            this.replaceWith('currentOrder.donationList')
        }
    }
});


/**
 * Vouchers Redeem Routes
 */

App.CustomVoucherRequestRoute = Em.Route.extend({
    setupController: function(controller, context) {
        // TODO: Find out why init() doesn't run automatically.
        controller.init();
    }
});


App.VoucherRedeemCodeRoute = Em.Route.extend({
    model: function(params) {
        var voucher = App.Voucher.find(params['code']);
        // We don't get the code from the server, but we want it to return it to the user here.
        voucher.set('code', params['code']);
        return voucher;
    },

    setupController: function(controller, voucher) {
        this.controllerFor('voucherRedeem').set('voucher', voucher);
    }
});


App.VoucherRedeemAddRoute = Em.Route.extend({

    setupController: function (controller, project) {
        var voucher = this.controllerFor('voucherRedeem').get('voucher');
        if (!voucher.get('isLoaded')) {
            var route = this;
            voucher.one("didLoad", function () {
                route.send('addDonation', voucher, project);
            });
        } else {
            this.send('addDonation', voucher, project);
        }
    },

    events: {
        addDonation: function (voucher, project) {
            if (!Em.isNone(project)) {
                var transaction = this.get('store').transaction();
                App.VoucherDonation.reopen({
                    url: 'fund/vouchers/' + voucher.get('code') + '/donations'
                });
                var donation = transaction.createRecord(App.VoucherDonation);
                donation.set('project', project);
                donation.set('voucher', voucher);
                // Ember object embedded isn't updated by server response. Manual update for embedded donation here.
                donation.on('didCreate', function(record){
                    voucher.get('donations').clear();
                    voucher.get('donations').pushObject(record);
                });
                transaction.commit();
                $.colorbox.close();
            }
        }
    }
});

App.VoucherRedeemRoute = Em.Route.extend({

    events: {
        addDonation: function (voucher, project) {
            if (!Em.isNone(project)) {
                var transaction = this.get('store').transaction();
                App.VoucherDonation.reopen({
                    url: 'fund/vouchers/' + voucher.get('code') + '/donations'
                });
                var donation = transaction.createRecord(App.VoucherDonation);
                donation.set('project', project);
                donation.set('voucher', voucher);
                // Ember object embedded isn't updated by server response. Manual update for embedded donation here.
                donation.on('didCreate', function(record){
                    voucher.get('donations').clear();
                    voucher.get('donations').pushObject(record);
                });
                transaction.commit();
                $.colorbox.close();
            }
        }
    }
});

App.UserIndexRoute = Em.Route.extend({
    redirect: function() {
        this.transitionTo('userProfile');
    }
});


App.UserProfileRoute = Em.Route.extend({
    model: function() {
        var route = this;

        return App.CurrentUser.find('current').then(function(user) {
            var profile = App.User.find(user.get('id_for_ember'));
            var controller = route.controllerFor('userProfile');

            // Set the model here instead of the promise in setupController so that the model can be used in the
            // startEditing() method.
            controller.set('model', profile);
            controller.startEditing();

            return profile;
        });
    },

    setupController: function(controller, profile) {
        // Don't set the model here because we're setting it after the promise is resolved.
    },

    exit: function() {
        this._super();
        this.controllerFor('userProfile').stopEditing();
    }
});


App.UserSettingsRoute = Em.Route.extend({

    model: function() {
        var route = this;

        return App.CurrentUser.find('current').then(function(user) {
            var settings = App.UserSettings.find(user.get('id_for_ember'));
            var controller = route.controllerFor('userSettings');

            // Set the model here instead of the promise in setupController so that the model can be used in the
            // startEditing() method.
            controller.set('model', settings);
            controller.startEditing();

            return settings;
        });
    },

    setupController: function(controller, profile) {
        // Don't set the model here because we're setting it after the promise is resolved.
    },

    exit: function() {
        this._super();
        this.controllerFor('userSettings').stopEditing();
    }
});


App.UserActivateRoute = Em.Route.extend({
    model: function(params) {
        var route = this;

        $.ajax({
            url: "/i18n/api/users/activate/" + params.activation_key,
            success: function() {
                var currentUser = App.CurrentUser.find('current');
                currentUser.get('stateManager').goToState('loaded');
                currentUser.one('didReload', function() {
                    // Set a welcome message for the user.
                    var displayName    = currentUser.get('first_name') ? currentUser.get('first_name') : currentUser.get('username');
                    var messageTitle   = "Hello " + displayName;
                    var messageContent = "Hurray! We're very happy that you joined 1%CLUB, welcome on board! You can start by filling in your profile.";

                    route.controllerFor('application').setProperties({
                        display_message: true,
                        message_title: messageTitle,
                        message_content: messageContent
                    });

                    // Unload the currentUser record from ember-data so that the UserProfile Route will load properly.
                    currentUser.unloadRecord();
                    route.replaceWith('userProfile');
                });
                currentUser.reload();
            },
            error: function() {
                // Notify user of the problem.
                route.controllerFor('application').setProperties({
                    display_message: true,
                    isError: true,
                    message_title: '',
                    message_content: 'There was a problem activating your account. Please contact us for assistance.'
                });

                route.replaceWith('home');
            }
        });
    }
});


App.SignupRoute = Em.Route.extend({
    redirect: function() {
        if (this.controllerFor('currentUser').get('isAuthenticated')) {
            this.transitionTo('home');
        }
    },

    model: function() {
        var transaction = this.get('store').transaction();
        // FIXME We need to set the first and last name to an empty string or we'll get a 500 error.
        // FIXME This is a workaround for a bug in DRF2.
        return transaction.createRecord(App.UserCreate, {first_name: '', last_name: ''});
    }
});


App.PasswordResetRoute = Em.Route.extend({
    model: function(params) {
        var route = this;

        var record = App.PasswordReset.createRecord({
            id: params.reset_token
        });

        // Need this so that the adapter makes a PUT instead of POST
        record.get('stateManager').transitionTo('loaded.saved');

        record.on('becameError', function() {
            route.controllerFor('application').setProperties({
                display_message: true,
                isError: true,
                message_title: '',
                message_content: 'The token you provided is expired. Please reset your password again.'
            });

            route.replaceWith('home');
        });

        this.get('store').transaction().add(record);
        return record;
    }
});


App.LoginController = Em.Controller.extend({

    requestPasswordReset: function() {
        // Close previous modal, if any.
        $('.close').click();

        var modalPaneTemplate = ['<div class="modal-body"><a class="close" rel="close">&times;</a>{{view templateName="request_password_reset"}}</div>'].join("\n");

        Bootstrap.ModalPane.popup({
            classNames: ['modal'],
            defaultTemplate: Em.Handlebars.compile(modalPaneTemplate),

            callback: function(opts, e) {
                if (opts.secondary) {
                    var $btn        = $(e.target),
                        $modal      = $btn.closest('.modal'),
                        $emailInput = $modal.find('#passwordResetEmail'),
                        $error      = $modal.find('#passwordResetError'),
                        email       = $emailInput.val();

                    $.ajax({
                        type: 'PUT',
                        url: '/i18n/api/users/passwordreset',
                        data: JSON.stringify({email: email}),
                        dataType: 'json',
                        contentType: 'application/json; charset=utf-8',
                        success: function() {
                            var $success = $("<p>YOU'VE GOT MAIL!</p><p>We've sent you a link to reset your password, so check your mailbox.</p><br><p>(No mail? It might have ended up in your spam folder)</p>");

                            $modal.find('.modal-body').html($success);
                            $btn.remove();
                        },
                        error: function(xhr) {
                            var error = $.parseJSON(xhr.responseText);
                            $error.html(error.email);
                            $error.removeClass('hidden');
                            $error.fadeIn();
                            $emailInput.addClass('error').val();
                            $emailInput.keyUp(function(){
                                $error.fadeOut();
                            });
                        }
                    });

                    return false;
                }
            }
        })
    }
});


/**
 * My Projects
 * - Manage your project(s)
 */

App.MyProjectListRoute = Em.Route.extend({
    model: function(params) {
        return App.MyProject.find();
    },
    setupController: function(controller, model) {
        this._super(controller, model);
    }

});


App.MyPitchNewRoute = Em.Route.extend({
    model: function(){
        var transaction = this.get('store').transaction();
        return transaction.createRecord(App.MyProject);
    }
});


App.MyProjectRoute = Em.Route.extend({
    // Load the Project
    model: function(params) {
        return App.MyProject.find(params.my_project_id);
    }
});


App.MyProjectPitchRoute =  Em.Route.extend({
    model: function(params) {
        return this.modelFor('myProject').get('pitch');
    }
});


App.MyProjectPitchSubRoute = Ember.Route.extend({
    redirect: function() {
        var status = this.modelFor('myProject').get('pitch.status');
        switch(status) {
            case 'submitted':
                this.transitionTo('myProjectPitchReview');
                break;
            case 'rejected':
                this.transitionTo('myProjectPitchRejected');
                break;
            case 'approved':
                this.transitionTo('myProjectPitchApproved');
                break;
        }
    },
    model: function(params) {
        return this.modelFor('myProject').get('pitch');
    },
    setupController: function(controller, model){
        this._super(controller, model);
        controller.startEditing();
    },
    exit: function(){
        if (this.get('controller')) {
            this.get('controller').stopEditing();
        }
    }

});


App.MyProjectPitchBasicsRoute = App.MyProjectPitchSubRoute.extend({});
App.MyProjectPitchLocationRoute = App.MyProjectPitchSubRoute.extend({});
App.MyProjectPitchMediaRoute = App.MyProjectPitchSubRoute.extend({});
App.MyProjectPitchSubmitRoute = App.MyProjectPitchSubRoute.extend({});

App.MyProjectPitchIndexRoute =  Em.Route.extend({
    redirect: function() {
        var status = this.modelFor('myProject').get('pitch.status');
        switch(status) {
            case 'submitted':
                this.transitionTo('myProjectPitchReview');
                break;
            case 'rejected':
                this.transitionTo('myProjectPitchRejected');
                break;
            case 'approved':
                this.transitionTo('myProjectPitchApproved');
                break;
        }
    },
    model: function(params) {
        return this.modelFor('myProject').get('pitch');
    }
});


App.MyProjectPitchReviewRoute = Em.Route.extend({
    model: function(params) {
        return this.modelFor('myProject').get('pitch');
    }
});


// My ProjectPlan routes

App.MyProjectPlanRoute = Em.Route.extend({
    model: function(params) {
        return this.modelFor('myProject').get('plan');
    }
});

App.MyProjectPlanSubRoute = Em.Route.extend({
    redirect: function() {
        var status = this.modelFor('myProject').get('plan.status');
        switch(status){
            case 'submitted':
                this.transitionTo('myProjectPlanReview');
                break;
            case 'rejected':
                this.transitionTo('myProjectPlanRejected');
                break;
            case 'approved':
                this.transitionTo('myProjectPlanApproved');
                break;
        }
    },

    model: function(params) {
        return this.modelFor('myProject').get('plan');
    },

    setupController: function(controller, model){
        this._super(controller, model);
        controller.startEditing();
    },

    exit: function(){
        if (this.get('controller')) {
            this.get('controller').stopEditing();
        }
    }
});

App.MyProjectPlanBasicsRoute = App.MyProjectPlanSubRoute.extend({});
App.MyProjectPlanDescriptionRoute = App.MyProjectPlanSubRoute.extend({});
App.MyProjectPlanLocationRoute = App.MyProjectPlanSubRoute.extend({});
App.MyProjectPlanMediaRoute = App.MyProjectPlanSubRoute.extend({});
App.MyProjectPlanAmbassadorsRoute = App.MyProjectPlanSubRoute.extend({});
App.MyProjectPlanSubmitRoute = App.MyProjectPlanSubRoute.extend({});

App.MyProjectPlanCampaignRoute = App.MyProjectPlanSubRoute.extend({});
App.MyProjectPlanBudgetRoute = App.MyProjectPlanSubRoute.extend({});

App.MyProjectPlanOrganisationRoute = App.MyProjectPlanSubRoute.extend({
    setupController: function(controller, model){
        this._super(controller, model);
        controller.set('organizations', App.MyOrganization.find());
    }
});

App.MyProjectPlanBankRoute = App.MyProjectPlanSubRoute.extend({});


App.MyProjectPlanLegalRoute = App.MyProjectPlanSubRoute.extend({});


App.MyProjectPlanIndexRoute = Ember.Route.extend({
    redirect: function() {
        var status = this.modelFor('myProject').get('plan.status');
        switch(status){
            case 'submitted':
                this.transitionTo('myProjectPlanReview');
                break;
            case 'rejected':
                this.transitionTo('myProjectPlanRejected');
                break;
            case 'approved':
                this.transitionTo('myProjectPlanApproved');
                break;
        }
    },

    model: function(params) {
        return this.modelFor('myProject').get('plan');
    }
});


App.MyProjectPlanReviewRoute = Em.Route.extend({
    model: function(params) {
        return this.modelFor('myProject').get('plan');
    }
});

App.MyProjectCampaignRoute = Em.Route.extend({
    model: function(params) {
        return this.modelFor('myProject');
    }
});


/* Home Page */

App.HomeRoute = Em.Route.extend({
    model: function(params) {
        return App.HomePage.find(App.get('language'));
    },

    setupController: function(controller, model) {
        this._super(controller, model);
        controller.set('projectIndex', 0).loadProject();
        controller.set('quoteIndex', 0).loadQuote();
    }
});


/* Static Pages */

App.PageRoute = Em.Route.extend({
    model: function(params) {
        var page =  App.Page.find(params.slug);
        var route = this;
        page.on('becameError', function(){
            route.transitionTo('error.notFound');
        });
        return page;
    }
});


/* Blogs & News */

App.NewsItemRoute = Em.Route.extend({
    model: function(params) {
        var newsItem =  App.News.find(params.news_id);
        var route = this;
        newsItem.on('becameError', function(){
            route.transitionTo('error.notFound');
        });
        return newsItem;
    }
});


App.NewsRoute = Em.Route.extend({
    model: function(params) {
        return App.NewsPreview.find({language: App.get('language')});
    }
});


App.NewsIndexRoute = Em.Route.extend({
    model: function(params) {
        return App.NewsPreview.find({language: App.get('language')});
    },
    // Redirect to the latest news item
    setupController: function(controller, model){
        this.send('showNews', model.objectAt(0).get('id'));
    }
});


/* Views */

App.LanguageView = Em.View.extend({
    templateName: 'language'
});


App.LanguageSwitchView = Em.CollectionView.extend({
    tagName: 'ul',
    classNames: ['nav-language'],
    content: App.interfaceLanguages,
    itemViewClass: App.LanguageView
});


App.LoginView = Em.View.extend({
    templateName: 'login',
    next: function(){
        return  String(window.location);
    }.property()
});



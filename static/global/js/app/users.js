/*
 Models
 */

/*
  A data model representing a user.

  Interacts with following public API:

  User Detail (GET/PUT):   /users/profiles/<pk>
 */
App.User = DS.Model.extend({
    url: 'users/profiles',

    username: DS.attr('string'),
    first_name: DS.attr('string'),
    last_name: DS.attr('string'),
    about: DS.attr('string'),
    why: DS.attr('string'),
    availability: DS.attr('string'),
    location: DS.attr('string'),

    picture: DS.attr('image'),

    website: DS.attr('string'),
    date_joined: DS.attr('date'),
    file: DS.attr('string'),

    // post-only fields (i.e. only used for user creation)
    email: DS.attr('string'),
    password: DS.attr('string'),

    getPicture: function() {
        if (this.get('picture')) {
            return '/static/media/' + this.get('picture.large')
        }
        return '/static/assets/images/default-avatar.png'
    }.property('picture'),

    getAvatar: function(){
        if (this.get('picture')) {
            return this.get('picture.square')
        }
        return '/static/assets/images/default-avatar.png'
    }.property('picture'),

    full_name: function() {
        if (!this.get('first_name') && !this.get('last_name')) {
            return this.get('username');
        }
        return this.get('first_name') + ' ' + this.get('last_name');
    }.property('first_name', 'last_name'),

    user_since: function() {
        return Globalize.format(this.get('date_joined'), 'd');
    }.property('date_joined')
});

/*
 A data model representing a user's settings.

 Interacts with following authenticated user API.

 User settings Detail (GET/PUT):  /users/settings/<pk>
 */
App.UserSettings = DS.Model.extend({
    url: 'users/settings',

    email: DS.attr('string'),
    newsletter: DS.attr('boolean'),
    share_time_knowledge: DS.attr('boolean'),
    share_money: DS.attr('boolean'),
    gender: DS.attr('string'),
    birthdate: DS.attr('date'),
    user_type: DS.attr('string'),

    // Address
    line1: DS.attr('string'),
    line2: DS.attr('string'),
    city: DS.attr('string'),
    state: DS.attr('string'),
    country: DS.attr('string'),
    postal_code: DS.attr('string')
});


App.UserPreview = DS.Model.extend({
    // There is no url for UserPreview because it's embedded.
    url: undefined,

    username: DS.attr('string'),
    first_name: DS.attr('string'),
    last_name: DS.attr('string'),
    avatar: DS.attr('string'),

    full_name: function() {
        if (!this.get('first_name') && !this.get('last_name')) {
            return this.get('username');
        }
        return this.get('first_name') + ' ' + this.get('last_name');
    }.property('first_name', 'last_name'),


    getAvatar: function() {
        if (this.get('avatar')) {
            return this.get('avatar')
        }
        return '/static/assets/images/default-avatar.png'
    }.property('avatar'),

    full_name: function() {
        if (!this.get('first_name') && !this.get('last_name')) {
            return this.get('username');
        }
        return this.get('first_name') + ' ' + this.get('last_name');
    }.property('first_name', 'last_name')

});

/*
 A data model representing currently authenticated user.

 Interacts with following authenticated user API:

 Logged in user (GET):            /users/current

 TODO: Should be unified to App.User model.
 */
App.CurrentUser = App.UserPreview.extend({
    url: 'users',

    // This is a hack to work around an issue with Ember-Data keeping the id as 'current'.
    // App.UserSettingsModel.find(App.CurrentUser.find('current').get('id_for_ember'));
    id_for_ember: DS.attr('number')
});


/*
 A model for creating users.

 Interacts with following public API:

 User (POST):   /users/

 */
App.UserCreate = DS.Model.extend({
    url: 'users',

    first_name: DS.attr('string'),
    last_name: DS.attr('string'),
    email: DS.attr('string'),
    password: DS.attr('string')
});


App.PasswordReset = DS.Model.extend({
    url: 'users/passwordset',

    new_password1: DS.attr('string'),
    new_password2: DS.attr('string')
});


/*
 Controllers
 */

// Inspiration from:
// http://stackoverflow.com/questions/14388249/accessing-controllers-from-other-controllers
App.CurrentUserController = Em.ObjectController.extend({
    init: function() {
        this._super();
        this.set("model", App.CurrentUser.find('current'));
    },

    isAuthenticated: function(){
        return (this.get('username')) ? true : false;
    }.property('username')
});


App.UserController = Ember.Controller.extend({
    needs: "currentUser"
});


App.UserProfileController = Ember.ObjectController.extend(App.Editable, {
    timeAvailableList: (function() {
        var list = Em.A();
        list.addObject({ name: '- - - - - - - - - - - - - - - - - -', value: ''});
        list.addObject({ name: '1-4 hours per week', value: '1-4_hours_week' });
        list.addObject({ name: '5-8 hours per week', value: '5-8_hours_week' });
        list.addObject({ name: '9-16 hours per week', value: '9-16_hours_week' });
        list.addObject({ name: '1-4 hours per month', value: '1-4_hours_month' });
        list.addObject({ name: '5-8 hours per month', value: '5-8_hours_month' });
        list.addObject({ name: '9-16 hours per month', value: '9-16_hours_month' });
        list.addObject({ name: 'I have all the time in the world. Bring it on :D', value: 'lots_of_time' });
        list.addObject({ name: 'It depends on the content of the tasks. Challenge me!', value: 'depends' });
        return list;
    }).property(),

    addFile: function(file, src){
        this.set('picture', file);

    },


    save: function(record) {
        var self = this;
        var record = record;

        this._super(record);

        record.one('didUpdate', function() {
            // Delay is added to workaround the bug that the store
            // hasn't finished loading new data to the record when
            // the "didUpdate" event is triggered. Promise API can be
            // used in newer versions of ember, so we can remove the delay then.
            Ember.run.later(self, 'updateCurrentUser', record, 1000);
        });
    },

    updateCurrentUser: function(record) {
        var currentUser = App.CurrentUser.find('current');
        currentUser.reload();
    }
});


App.UserSettingsController = Ember.ObjectController.extend(App.Editable, {
    userTypeList: (function() {
        var list = Em.A();
        list.addObject({ name: 'Person', value: 'person'});
        list.addObject({ name: 'Group', value: 'group'});
        list.addObject({ name: 'Foundation', value: 'foundation'});
        list.addObject({ name: 'School', value: 'school'});
        list.addObject({ name: 'Company', value: 'company'});
        return list;
    }).property()
});


App.UserModalController = Ember.ObjectController.extend({
    loadProfile: function() {
        var model = this.get('model');
        var id = model.get('id');

        if (id == "current") {
            // Get user id for current user
            id = model.get('id_for_ember');
        }

        this.set('model', App.User.find(id));
    }.observes('model')
});


App.SignupController = Ember.ObjectController.extend({
    isUserCreated: false,

    needs: "currentUser",

    createUser: function(user) {
        var self = this;

        user.one('didCreate', function() {
            self.set('isUserCreated', true);
        });

        // Change the model URL to the User creation API.
        user.set('url', 'users');
        user.get('transaction').commit();
    }
});


App.PasswordResetController = Ember.ObjectController.extend({
    needs: ['login'],

    resetDisabled: (function() {
        if (this.get('new_password1') || this.get('new_password2')) {
            return false;
        }

        return true;
    }).property('content.new_password1', 'content.new_password2'),

    resetPassword: function(record) {
        var passwordResetController = this;

        record.on('didUpdate', function() {
            var loginController = passwordResetController.get('controllers.login');
            var view = App.LoginView.create({
                next: "/"
            });
            view.set('controller', loginController);

            loginController.set('post_password_reset', true);

            var modalPaneTemplate = '{{view view.bodyViewClass}}';

            Bootstrap.ModalPane.popup({
                classNames: ['modal'],
                defaultTemplate: Em.Handlebars.compile(modalPaneTemplate),
                bodyViewClass: view
            });
        });

        record.get('transaction').commit();
    }
});


App.UserModalView = Em.View.extend({
    templateName: 'user_modal'
});
